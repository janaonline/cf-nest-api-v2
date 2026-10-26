import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { PmuUndoRowFormsService } from './pmu-undo-rows.service';

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
// A real design-year id, so the FC Unspent path can resolve its applicable FC.
const REAL_YEAR = new Types.ObjectId('67d7d136d3d038946a5239e9');
const user = { _id: new Types.ObjectId().toString() } as unknown as AuthUser;
const ctx = { user, ip: '1.1.1.1', userAgent: 'jest' };

const row = (rowStatus: number | null) => ({ _id: new Types.ObjectId(), rowStatus, rejectionRemark: null });

describe('PmuUndoRowFormsService', () => {
  let session: { startTransaction: jest.Mock; commitTransaction: jest.Mock; abortTransaction: jest.Mock; endSession: jest.Mock };
  let eulbFormModel: { findOne: jest.Mock; db: { startSession: jest.Mock } };
  let fcFormModel: { findOne: jest.Mock; db: { startSession: jest.Mock } };
  let formHelper: { transitionForm: jest.Mock; writeUndoHistory: jest.Mock };
  let rowHelper: { getActiveRows: jest.Mock; undoRows: jest.Mock };
  let eligibility: { assertNoClaimLetterLocks: jest.Mock };
  let service: PmuUndoRowFormsService;

  const eulbForm = (status: number, extra: Record<string, unknown> = {}) =>
    jest.fn().mockReturnValue(
      q({ _id: formOid, state: stateOid, year: yearOid, currentFormStatus: status, activeDatasetVersion: 2, pmuRemarks: 'Old', ...extra }),
    );
  const fcForm = (status: number, extra: Record<string, unknown> = {}) =>
    jest.fn().mockReturnValue(
      q({
        _id: formOid,
        state: stateOid,
        year: REAL_YEAR,
        currentFormStatus: status,
        isFcUnspent: true,
        fcDeclaration: null,
        fcUnspentDeclaration: null,
        checkboxConfirmation: true,
        auditRevision: 4,
        pmuRemarks: 'Old',
        ...extra,
      }),
    );

  beforeEach(() => {
    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    eulbFormModel = { findOne: eulbForm(FORM_STATUS.UNDER_REVIEW_BY_MOHUA), db: { startSession: jest.fn().mockResolvedValue(session) } };
    fcFormModel = { findOne: fcForm(FORM_STATUS.RETURNED_BY_PMU), db: { startSession: jest.fn().mockResolvedValue(session) } };
    formHelper = { transitionForm: jest.fn().mockResolvedValue({}), writeUndoHistory: jest.fn().mockResolvedValue(undefined) };
    rowHelper = { getActiveRows: jest.fn().mockResolvedValue([]), undoRows: jest.fn().mockResolvedValue(0) };
    eligibility = { assertNoClaimLetterLocks: jest.fn().mockResolvedValue(undefined) };

    service = new PmuUndoRowFormsService(
      eulbFormModel as never,
      {} as never,
      {} as never,
      {} as never,
      fcFormModel as never,
      {} as never,
      {} as never,
      {} as never,
      formHelper as never,
      rowHelper as never,
      eligibility as never,
    );
  });

  describe('Elected Body', () => {
    it('404s when the form does not exist', async () => {
      eulbFormModel.findOne = jest.fn().mockReturnValue(q(null));
      await expect(service.undoElectedBody(stateOid, yearOid, ctx)).rejects.toThrow(NotFoundException);
    });

    it.each([FORM_STATUS.UNDER_REVIEW_BY_PMU, FORM_STATUS.IN_PROGRESS])(
      'refuses when there is no PMU decision to undo (status %i)',
      async (status) => {
        eulbFormModel.findOne = eulbForm(status);
        await expect(service.undoElectedBody(stateOid, yearOid, ctx)).rejects.toThrow(ForbiddenException);
        expect(rowHelper.getActiveRows).not.toHaveBeenCalled();
      },
    );

    it('refuses once a claim letter exists, before reading rows or opening a transaction', async () => {
      eligibility.assertNoClaimLetterLocks.mockRejectedValueOnce(new ConflictException('claim started'));
      await expect(service.undoElectedBody(stateOid, yearOid, ctx)).rejects.toThrow(ConflictException);
      expect(rowHelper.getActiveRows).not.toHaveBeenCalled();
      expect(eulbFormModel.db.startSession).not.toHaveBeenCalled();
    });

    it('reopens only the PMU-decided rows (5 and 14), then the form conditionally, and commits', async () => {
      const approved = row(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      const returned = row(FORM_STATUS.RETURNED_BY_PMU);
      rowHelper.getActiveRows.mockResolvedValue([approved, returned, row(FORM_STATUS.UNDER_REVIEW_BY_PMU), row(null)]);
      rowHelper.undoRows.mockResolvedValue(2);

      const result = await service.undoElectedBody(stateOid, yearOid, ctx);

      expect(rowHelper.getActiveRows).toHaveBeenCalledWith(expect.objectContaining({ formId: formOid, datasetVersion: 2 }));
      const undoArgs = rowHelper.undoRows.mock.calls[0][0] as { rows: unknown[] };
      expect(undoArgs.rows).toEqual([approved, returned]);

      const transition = formHelper.transitionForm.mock.calls[0][0] as Record<string, unknown>;
      expect(transition['expectedStatus']).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      expect(transition['session']).toBe(session);
      expect(transition['setFields']).toMatchObject({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU, pmuRemarks: null });

      const history = formHelper.writeUndoHistory.mock.calls[0][0] as { fromStatus: number; buildDocument: (s: unknown) => Record<string, unknown> };
      expect(history.fromStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      const first = history.buildDocument({ fromStatus: 5, toStatus: FORM_STATUS.UNDO, changedAt: new Date() });
      const second = history.buildDocument({ fromStatus: FORM_STATUS.UNDO, toStatus: 13, changedAt: new Date() });
      expect(first['remarks']).toBe('Old'); // the cleared remark survives on the first entry
      expect(second['remarks']).toBeUndefined();

      expect(session.commitTransaction).toHaveBeenCalledTimes(1);
      expect(session.abortTransaction).not.toHaveBeenCalled();
      expect(session.endSession).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual({ currentFormStatus: 13, currentFormStatusLabel: 'Under Review by PMU' });
    });

    it('aborts with a 409 when a row moved under it (fewer rows updated than expected), writing no form change', async () => {
      rowHelper.getActiveRows.mockResolvedValue([row(FORM_STATUS.UNDER_REVIEW_BY_MOHUA), row(FORM_STATUS.RETURNED_BY_PMU)]);
      rowHelper.undoRows.mockResolvedValue(1);

      await expect(service.undoElectedBody(stateOid, yearOid, ctx)).rejects.toThrow(ConflictException);

      expect(formHelper.transitionForm).not.toHaveBeenCalled();
      expect(session.abortTransaction).toHaveBeenCalledTimes(1);
      expect(session.commitTransaction).not.toHaveBeenCalled();
      expect(session.endSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('FC Unspent', () => {
    it('404s when the design year has no applicable FC mapping', async () => {
      await expect(service.undoFcUnspent(stateOid, new Types.ObjectId(), ctx)).rejects.toThrow(NotFoundException);
    });

    it('404s when the form does not exist', async () => {
      fcFormModel.findOne = jest.fn().mockReturnValue(q(null));
      await expect(service.undoFcUnspent(stateOid, REAL_YEAR, ctx)).rejects.toThrow(NotFoundException);
    });

    it('refuses when there is no PMU decision to undo', async () => {
      fcFormModel.findOne = fcForm(FORM_STATUS.UNDER_REVIEW_BY_PMU);
      await expect(service.undoFcUnspent(stateOid, REAL_YEAR, ctx)).rejects.toThrow(ForbiddenException);
    });

    it('refuses once MoHUA has decided any row, before opening a transaction', async () => {
      rowHelper.getActiveRows.mockResolvedValue([row(FORM_STATUS.UNDER_REVIEW_BY_MOHUA), row(FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA)]);

      await expect(service.undoFcUnspent(stateOid, REAL_YEAR, ctx)).rejects.toThrow(BadRequestException);
      expect(fcFormModel.db.startSession).not.toHaveBeenCalled();
    });

    it('reopens PMU-decided rows and bumps the audit revision on the form and both history entries', async () => {
      rowHelper.getActiveRows.mockResolvedValue([row(FORM_STATUS.RETURNED_BY_PMU), row(FORM_STATUS.UNDER_REVIEW_BY_MOHUA)]);
      rowHelper.undoRows.mockResolvedValue(2);

      await service.undoFcUnspent(stateOid, REAL_YEAR, ctx);

      const transition = formHelper.transitionForm.mock.calls[0][0] as { setFields: Record<string, unknown>; expectedStatus: number };
      expect(transition.expectedStatus).toBe(FORM_STATUS.RETURNED_BY_PMU);
      expect(transition.setFields).toMatchObject({ currentFormStatus: 13, auditRevision: 5, pmuRemarks: null });

      const history = formHelper.writeUndoHistory.mock.calls[0][0] as { buildDocument: (s: unknown) => Record<string, unknown> };
      const doc = history.buildDocument({ fromStatus: 14, toStatus: FORM_STATUS.UNDO, changedAt: new Date() });
      expect(doc['auditRevision']).toBe(5);
      expect(doc['applicableFc']).toBeDefined();
      expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('has no rows to reopen on the No branch, but still returns the form to 13', async () => {
      fcFormModel.findOne = fcForm(FORM_STATUS.UNDER_REVIEW_BY_MOHUA, { isFcUnspent: false });

      await service.undoFcUnspent(stateOid, REAL_YEAR, ctx);

      expect(rowHelper.getActiveRows).not.toHaveBeenCalled();
      expect((rowHelper.undoRows.mock.calls[0][0] as { rows: unknown[] }).rows).toEqual([]);
      expect(formHelper.transitionForm).toHaveBeenCalledTimes(1);
    });
  });
});
