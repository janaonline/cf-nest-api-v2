import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { PmuUndoEligibilityService, type PmuUndoForm } from './pmu-undo-eligibility.service';

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const form: PmuUndoForm = { type: 'ELECTED_BODY', id: new Types.ObjectId() };
const pmuAdmin = { _id: 'u1', scope: Scope.PMU, xviFcSubrole: 'admin' } as unknown as AuthUser;
const pmuViewer = { _id: 'u2', scope: Scope.PMU, xviFcSubrole: 'viewer' } as unknown as AuthUser;

/** A query chain whose `exec()` resolves to `result`. */
function q<T>(result: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['sort', 'select', 'session', 'lean']) chain[m] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(result);
  return chain;
}

describe('PmuUndoEligibilityService', () => {
  let lockModel: { exists: jest.Mock };
  let guardModel: { updateOne: jest.Mock };
  let historyModel: { findOne: jest.Mock };
  let service: PmuUndoEligibilityService;

  const locks = (found: boolean) => lockModel.exists.mockReturnValue(q(found ? { _id: 1 } : null));
  /** The form's latest history entry. */
  const latest = (fromStatus: number, toStatus: number) => historyModel.findOne.mockReturnValue(q({ fromStatus, toStatus }));

  beforeEach(() => {
    lockModel = { exists: jest.fn() };
    guardModel = { updateOne: jest.fn().mockReturnValue(q({ acknowledged: true })) };
    historyModel = { findOne: jest.fn() };
    locks(false);
    latest(FORM_STATUS.UNDER_REVIEW_BY_PMU, FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    const other = { findOne: jest.fn() };
    service = new PmuUndoEligibilityService(
      lockModel as never,
      guardModel as never,
      other as never,
      other as never,
      other as never,
      historyModel as never,
      other as never,
    );
  });

  it('looks for a lock by state AND year, so another cycle never blocks this one', async () => {
    await service.hasClaimLetterLocks(stateOid, yearOid);
    expect(lockModel.exists).toHaveBeenCalledWith({ state: stateOid, year: yearOid });
  });

  it('throws a 409 when any lock exists, and passes when none does', async () => {
    await expect(service.assertNoClaimLetterLocks(stateOid, yearOid)).resolves.toBeUndefined();

    locks(true);
    await expect(service.assertNoClaimLetterLocks(stateOid, yearOid)).rejects.toThrow(ConflictException);
  });

  describe('touchClaimUndoGuard', () => {
    const session = {} as never;

    it('upserts the one guard document of the State + year in the caller transaction', async () => {
      await service.touchClaimUndoGuard(stateOid, yearOid, session);
      expect(guardModel.updateOne).toHaveBeenCalledWith(
        { state: stateOid, year: yearOid },
        { $inc: { writes: 1 } },
        { upsert: true, session },
      );
    });

    it.each([112, 11000])('turns a concurrent write (code %i) into a 409 the user can retry', async (code) => {
      guardModel.updateOne.mockReturnValue({ exec: () => Promise.reject(Object.assign(new Error('conflict'), { code })) });
      await expect(service.touchClaimUndoGuard(stateOid, yearOid, session)).rejects.toThrow(ConflictException);
    });
  });

  describe('isPmuDecision', () => {
    it('is true when the latest entry is PMU moving the form from 13 to its current status', async () => {
      await expect(service.isPmuDecision(form, FORM_STATUS.UNDER_REVIEW_BY_MOHUA)).resolves.toBe(true);
      expect(historyModel.findOne).toHaveBeenCalledWith({ eulbForm: form.id });
    });

    it('is false for a form the State submitted straight to 5 before the PMU stage existed', async () => {
      latest(FORM_STATUS.IN_PROGRESS, FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      await expect(service.isPmuDecision(form, FORM_STATUS.UNDER_REVIEW_BY_MOHUA)).resolves.toBe(false);
      await expect(service.assertPmuDecision(form, FORM_STATUS.UNDER_REVIEW_BY_MOHUA)).rejects.toThrow(ForbiddenException);
    });

    it('is false with no history at all', async () => {
      historyModel.findOne.mockReturnValue(q(null));
      await expect(service.isPmuDecision(form, FORM_STATUS.UNDER_REVIEW_BY_MOHUA)).resolves.toBe(false);
    });
  });

  describe('canUndo', () => {
    it.each([FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.RETURNED_BY_PMU])(
      'allows undo of status %i for a PMU admin when PMU decided it and no claim letter exists',
      async (status) => {
        latest(FORM_STATUS.UNDER_REVIEW_BY_PMU, status);
        await expect(service.canUndo(pmuAdmin, status, stateOid, yearOid, form)).resolves.toBe(true);
      },
    );

    it.each([
      FORM_STATUS.UNDER_REVIEW_BY_PMU,
      FORM_STATUS.IN_PROGRESS,
      FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
      FORM_STATUS.RETURNED_BY_MOHUA,
    ])('has nothing to undo at status %i', async (status) => {
      await expect(service.canUndo(pmuAdmin, status, stateOid, yearOid, form)).resolves.toBe(false);
    });

    it('hides undo from a PMU viewer, and when a claim letter exists', async () => {
      await expect(service.canUndo(pmuViewer, FORM_STATUS.UNDER_REVIEW_BY_MOHUA, stateOid, yearOid, form)).resolves.toBe(false);

      locks(true);
      await expect(service.canUndo(pmuAdmin, FORM_STATUS.UNDER_REVIEW_BY_MOHUA, stateOid, yearOid, form)).resolves.toBe(false);
    });

    it('hides undo from a non-PMU user even if a permission override grants PMU approval (the endpoint refuses them)', async () => {
      const mohuaWithOverride = {
        _id: 'u3',
        scope: Scope.MOHUA,
        xviFcSubrole: 'admin',
        permissionOverrides: { allow: [Permission.APPROVE_STATE_SUBMISSIONS_PMU] },
      } as unknown as AuthUser;
      await expect(service.canUndo(mohuaWithOverride, FORM_STATUS.UNDER_REVIEW_BY_MOHUA, stateOid, yearOid, form)).resolves.toBe(
        false,
      );
    });

    it('hides undo for a legacy status set before the PMU stage', async () => {
      latest(FORM_STATUS.IN_PROGRESS, FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      await expect(service.canUndo(pmuAdmin, FORM_STATUS.UNDER_REVIEW_BY_MOHUA, stateOid, yearOid, form)).resolves.toBe(false);
    });
  });
});
