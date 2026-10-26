import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { PmuUndoEligibilityService } from './pmu-undo-eligibility.service';

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const pmuAdmin = { _id: 'u1', scope: Scope.PMU, xviFcSubrole: 'admin' } as unknown as AuthUser;
const pmuViewer = { _id: 'u2', scope: Scope.PMU, xviFcSubrole: 'viewer' } as unknown as AuthUser;

describe('PmuUndoEligibilityService', () => {
  let lockModel: { exists: jest.Mock };
  let service: PmuUndoEligibilityService;

  const locks = (found: boolean) => lockModel.exists.mockReturnValue({ exec: () => Promise.resolve(found ? { _id: 1 } : null) });

  beforeEach(() => {
    lockModel = { exists: jest.fn() };
    locks(false);
    service = new PmuUndoEligibilityService(lockModel as never);
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

  it.each([FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.RETURNED_BY_PMU])(
    'allows undo of status %i for a PMU admin when no claim letter exists',
    async (status) => {
      await expect(service.canUndo(pmuAdmin, status, stateOid, yearOid)).resolves.toBe(true);
    },
  );

  it.each([
    FORM_STATUS.UNDER_REVIEW_BY_PMU,
    FORM_STATUS.IN_PROGRESS,
    FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
    FORM_STATUS.RETURNED_BY_MOHUA,
  ])('has nothing to undo at status %i', async (status) => {
    await expect(service.canUndo(pmuAdmin, status, stateOid, yearOid)).resolves.toBe(false);
  });

  it('hides undo from a PMU viewer, and when a claim letter exists', async () => {
    await expect(service.canUndo(pmuViewer, FORM_STATUS.UNDER_REVIEW_BY_MOHUA, stateOid, yearOid)).resolves.toBe(false);

    locks(true);
    await expect(service.canUndo(pmuAdmin, FORM_STATUS.UNDER_REVIEW_BY_MOHUA, stateOid, yearOid)).resolves.toBe(false);
  });
});
