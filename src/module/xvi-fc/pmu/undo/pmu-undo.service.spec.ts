import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS, FormHistoryAction } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import type { PmuUndoDto } from './pmu-undo.dto';
import { PmuUndoService } from './pmu-undo.service';

/** `Model.findOne(...).select().lean().exec()` chain. */
function q<T>(result: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'lean']) chain[m] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(result);
  return chain;
}

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const formOid = new Types.ObjectId();
const pmuUser = { _id: new Types.ObjectId().toString(), scope: Scope.PMU } as unknown as AuthUser;
const stateUser = { _id: new Types.ObjectId().toString(), scope: Scope.STATE } as unknown as AuthUser;

describe('PmuUndoService', () => {
  let sfcModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };
  let sfcHistory: { create: jest.Mock };
  let gtcModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };
  let gtcHistory: { create: jest.Mock };
  let rowForms: { undoElectedBody: jest.Mock; undoFcUnspent: jest.Mock };
  let eligibility: { assertNoClaimLetterLocks: jest.Mock };
  let service: PmuUndoService;

  const formAt = (status: number, extra: Record<string, unknown> = {}) =>
    jest.fn().mockReturnValue(q({ _id: formOid, state: stateOid, year: yearOid, currentFormStatus: status, ...extra }));

  const run = (dto: Partial<PmuUndoDto> & Pick<PmuUndoDto, 'type'>, user: AuthUser = pmuUser) =>
    service.undo({ stateId: stateOid.toString(), yearId: yearOid.toString(), ...dto } as PmuUndoDto, user, '1.1.1.1', 'jest');

  beforeEach(() => {
    sfcModel = { findOne: formAt(FORM_STATUS.UNDER_REVIEW_BY_MOHUA), findOneAndUpdate: jest.fn().mockReturnValue(q({ _id: formOid })) };
    sfcHistory = { create: jest.fn().mockResolvedValue([]) };
    gtcModel = { findOne: formAt(FORM_STATUS.RETURNED_BY_PMU, { installment: 1 }), findOneAndUpdate: jest.fn().mockReturnValue(q({ _id: formOid })) };
    gtcHistory = { create: jest.fn().mockResolvedValue([]) };
    rowForms = { undoElectedBody: jest.fn().mockResolvedValue('eulb'), undoFcUnspent: jest.fn().mockResolvedValue('fc') };
    eligibility = { assertNoClaimLetterLocks: jest.fn().mockResolvedValue(undefined) };

    service = new PmuUndoService(
      sfcModel as never,
      sfcHistory as never,
      gtcModel as never,
      gtcHistory as never,
      { findOne: jest.fn() } as never,
      { create: jest.fn() } as never,
      rowForms as never,
      new StateFormPmuReviewHelper(),
      eligibility as never,
    );
  });

  describe('access and routing', () => {
    it('refuses a non-PMU user before touching anything', async () => {
      await expect(run({ type: 'SFC_STATUS' }, stateUser)).rejects.toThrow(ForbiddenException);
      expect(sfcModel.findOne).not.toHaveBeenCalled();
    });

    it('hands the two row-bearing forms to the row service with ObjectIds', async () => {
      await run({ type: 'ELECTED_BODY' });
      await run({ type: 'FC_UNSPENT' });
      expect(rowForms.undoElectedBody).toHaveBeenCalledWith(stateOid, yearOid, expect.objectContaining({ ip: '1.1.1.1' }));
      expect(rowForms.undoFcUnspent).toHaveBeenCalledWith(stateOid, yearOid, expect.objectContaining({ userAgent: 'jest' }));
    });

    it.each(['GTC', 'DEVOLUTION_FORMULA'] as const)('rejects %s without an installment', async (type) => {
      await expect(run({ type })).rejects.toThrow(BadRequestException);
    });
  });

  describe('whole-form undo (SFC Status)', () => {
    it('404s when the form does not exist', async () => {
      sfcModel.findOne = jest.fn().mockReturnValue(q(null));
      await expect(run({ type: 'SFC_STATUS' })).rejects.toThrow(NotFoundException);
    });

    it.each([FORM_STATUS.UNDER_REVIEW_BY_PMU, FORM_STATUS.IN_PROGRESS, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA])(
      'refuses when there is no PMU decision to undo (status %i)',
      async (status) => {
        sfcModel.findOne = formAt(status);
        await expect(run({ type: 'SFC_STATUS' })).rejects.toThrow(ForbiddenException);
        expect(sfcModel.findOneAndUpdate).not.toHaveBeenCalled();
      },
    );

    it('refuses once a claim letter exists, before touching the form', async () => {
      eligibility.assertNoClaimLetterLocks.mockRejectedValueOnce(new ConflictException('claim started'));
      await expect(run({ type: 'SFC_STATUS' })).rejects.toThrow(ConflictException);
      expect(sfcModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.RETURNED_BY_PMU])(
      'moves status %i back to 13 conditionally, clears the remark and logs %i -> 10 -> 13',
      async (status) => {
        sfcModel.findOne = formAt(status, { pmuRemarks: 'Old remark' });

        const result = await run({ type: 'SFC_STATUS' });

        const [filter, update] = sfcModel.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>, { $set: object }];
        expect(filter).toEqual({ _id: formOid, currentFormStatus: status });
        expect(update.$set).toMatchObject({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU, pmuRemarks: null });
        expect(result.data).toEqual({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU, currentFormStatusLabel: 'Under Review by PMU' });

        const [docs] = sfcHistory.create.mock.calls[0] as [Record<string, unknown>[]];
        expect(docs.map((d) => [d['fromStatus'], d['toStatus'], d['action']])).toEqual([
          [status, FORM_STATUS.UNDO, FormHistoryAction.PMU_UNDO],
          [FORM_STATUS.UNDO, FORM_STATUS.UNDER_REVIEW_BY_PMU, FormHistoryAction.PMU_UNDO],
        ]);
        expect(docs[0]['sfcStatusForm']).toBe(formOid);
        expect(docs[0]['remarks']).toBe('Old remark'); // the cleared remark survives in history
        expect(docs[1]['remarks']).toBeNull();
        expect((docs[1]['changedAt'] as Date).getTime()).toBeGreaterThan((docs[0]['changedAt'] as Date).getTime());
      },
    );

    it('reports a 409 when the status changed under it, and writes no history', async () => {
      sfcModel.findOneAndUpdate = jest.fn().mockReturnValue(q(null));
      await expect(run({ type: 'SFC_STATUS' })).rejects.toThrow(ConflictException);
      expect(sfcHistory.create).not.toHaveBeenCalled();
    });
  });

  describe('whole-form undo, installment-scoped (GTC)', () => {
    it('looks the form up by installment and carries it onto the history entries', async () => {
      await run({ type: 'GTC', installment: 1 });

      expect(gtcModel.findOne).toHaveBeenCalledWith({ state: stateOid, year: yearOid, installment: 1 });
      const [docs] = gtcHistory.create.mock.calls[0] as [Record<string, unknown>[]];
      expect(docs.every((d) => d['installment'] === 1 && d['gtcForm'] === formOid)).toBe(true);
    });
  });
});
