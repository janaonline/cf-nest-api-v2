import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import {
  ClaimLetterUlbLock,
  ClaimLetterUlbLockDocument,
} from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { canPmuUndoForm } from '../utils/xvi-fc-form-status-access.util';

/** Row statuses only MoHUA sets (acknowledged / returned) — once any exists, PMU can no longer undo. */
export const MOHUA_DECIDED_ROW_STATUSES: readonly number[] = [
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
  FORM_STATUS.RETURNED_BY_MOHUA,
];

/**
 * When a PMU decision (approve → 5, return → 14) may still be undone, shared by all five PMU review
 * modules. Besides the form being in one of those two statuses and the caller holding the PMU approve
 * permission, the State must not have started a claim letter for that year: a lock in
 * `xvifc_claim_letter_ulb_locks` (state + year, any installment, ACTIVE or ACKNOWLEDGED) means a claim
 * has been built on these statuses, so they must stay put. Abandoning a draft releases its locks, so
 * "no lock" is exactly "no claim letter in use".
 */
@Injectable()
export class PmuUndoEligibilityService {
  constructor(
    @InjectModel(ClaimLetterUlbLock.name) private readonly lockModel: Model<ClaimLetterUlbLockDocument>,
  ) {}

  async hasClaimLetterLocks(stateOid: Types.ObjectId, yearOid: Types.ObjectId): Promise<boolean> {
    const found = await this.lockModel.exists({ state: stateOid, year: yearOid }).exec();
    return found !== null;
  }

  /** Throws 409 when a claim letter has been started — the undo endpoints' guard. */
  async assertNoClaimLetterLocks(stateOid: Types.ObjectId, yearOid: Types.ObjectId): Promise<void> {
    if (await this.hasClaimLetterLocks(stateOid, yearOid)) {
      throw new ConflictException(
        'A claim letter has already been started for this state and year, so this decision can no longer be undone.',
      );
    }
  }

  /** What the review metadata GET reports as `permissions.canUndo`, so the UI only shows the button when
   *  the endpoint would accept it. */
  async canUndo(user: AuthUser, status: number, stateOid: Types.ObjectId, yearOid: Types.ObjectId): Promise<boolean> {
    if (!getEffectivePermissions(user).includes(Permission.APPROVE_STATE_SUBMISSIONS_PMU)) return false;
    if (!canPmuUndoForm(status)) return false;
    return !(await this.hasClaimLetterLocks(stateOid, yearOid));
  }
}
