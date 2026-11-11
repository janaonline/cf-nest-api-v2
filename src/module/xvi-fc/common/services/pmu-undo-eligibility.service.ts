import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import {
  ClaimLetterUlbLock,
  ClaimLetterUlbLockDocument,
} from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import { ClaimUndoGuard, ClaimUndoGuardDocument } from 'src/schemas/xvi-fc/state/claim-undo-guard.schema';
import {
  DevolutionFormulaFormHistory,
  DevolutionFormulaFormHistoryDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-form-history.schema';
import {
  ElectedUrbanLocalBodiesFormHistory,
  EulbFormHistoryDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form-history.schema';
import {
  XviFcUnspentStateFormHistory,
  XviFcUnspentStateFormHistoryDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-history.schema';
import { XviFcGtcHistory, XviFcGtcHistoryDocument } from 'src/schemas/xvi-fc/state/gtc-form-history.schema';
import {
  XviFcSfcStatusHistory,
  XviFcSfcStatusHistoryDocument,
} from 'src/schemas/xvi-fc/state/sfc-status-history.schema';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { canPmuUndoForm } from '../utils/xvi-fc-form-status-access.util';
import { hasReviewerAccess } from '../utils/xvi-fc-reviewer-access.util';

/** Row statuses only MoHUA sets (acknowledged / returned) — once any exists, PMU can no longer undo. */
export const MOHUA_DECIDED_ROW_STATUSES: readonly number[] = [
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
  FORM_STATUS.RETURNED_BY_MOHUA,
];

/** The five State forms PMU reviews, as `POST xvi-fc/pmu/undo` names them. */
export type PmuUndoFormType = 'SFC_STATUS' | 'GTC' | 'DEVOLUTION_FORMULA' | 'ELECTED_BODY' | 'FC_UNSPENT';

export interface PmuUndoForm {
  type: PmuUndoFormType;
  id: Types.ObjectId;
}

/** Mongo's write conflict, and the duplicate key two transactions hit creating the same first guard. */
const WRITE_CONFLICT_CODES = new Set([112, 11000]);

/**
 * When a PMU decision (approve → 5, return → 14) may still be undone, shared by all five PMU review
 * modules. Besides the form being in one of those two statuses and the caller being a PMU approver:
 * - the status must actually be PMU's decision: a form that reached 5 by a State submit from before the
 *   PMU stage existed has nothing to undo (see `isPmuDecision`);
 * - the State must not have started a claim letter for that year: a lock in `xvifc_claim_letter_ulb_locks`
 *   (state + year, any installment, ACTIVE or ACKNOWLEDGED) means a claim has been built on these statuses.
 *   Abandoning a draft releases its locks, so "no lock" is exactly "no claim letter in use". An undo and a
 *   claim taking its locks are serialized by `touchClaimUndoGuard`.
 */
@Injectable()
export class PmuUndoEligibilityService {
  private readonly historyByType: Record<PmuUndoFormType, { model: Model<unknown>; formField: string }>;

  constructor(
    @InjectModel(ClaimLetterUlbLock.name) private readonly lockModel: Model<ClaimLetterUlbLockDocument>,
    @InjectModel(ClaimUndoGuard.name) private readonly guardModel: Model<ClaimUndoGuardDocument>,
    @InjectModel(XviFcSfcStatusHistory.name) sfcHistory: Model<XviFcSfcStatusHistoryDocument>,
    @InjectModel(XviFcGtcHistory.name) gtcHistory: Model<XviFcGtcHistoryDocument>,
    @InjectModel(DevolutionFormulaFormHistory.name) dfHistory: Model<DevolutionFormulaFormHistoryDocument>,
    @InjectModel(ElectedUrbanLocalBodiesFormHistory.name) eulbHistory: Model<EulbFormHistoryDocument>,
    @InjectModel(XviFcUnspentStateFormHistory.name) fcHistory: Model<XviFcUnspentStateFormHistoryDocument>,
  ) {
    this.historyByType = {
      SFC_STATUS: { model: sfcHistory as Model<unknown>, formField: 'sfcStatusForm' },
      GTC: { model: gtcHistory as Model<unknown>, formField: 'gtcForm' },
      DEVOLUTION_FORMULA: { model: dfHistory as Model<unknown>, formField: 'devolutionFormulaForm' },
      ELECTED_BODY: { model: eulbHistory as Model<unknown>, formField: 'eulbForm' },
      FC_UNSPENT: { model: fcHistory as Model<unknown>, formField: 'fcUnspentForm' },
    };
  }

  /** Read in the caller's transaction when one is passed, so it sees the snapshot the undo writes against. */
  async hasClaimLetterLocks(stateOid: Types.ObjectId, yearOid: Types.ObjectId, session?: ClientSession): Promise<boolean> {
    const query = this.lockModel.exists({ state: stateOid, year: yearOid });
    if (session) query.session(session);
    return (await query.exec()) !== null;
  }

  /** Throws 409 when a claim letter has been started — the undo endpoints' guard. */
  async assertNoClaimLetterLocks(stateOid: Types.ObjectId, yearOid: Types.ObjectId, session?: ClientSession): Promise<void> {
    if (await this.hasClaimLetterLocks(stateOid, yearOid, session)) {
      throw new ConflictException(
        'A claim letter has already been started for this state and year, so this decision can no longer be undone.',
      );
    }
  }

  /**
   * Written by a PMU undo and by every claim-letter lock insert, inside their own transactions, for the
   * same State + year. Overlapping ones then conflict and Mongo aborts one: an undo can never slip between
   * a claim taking its locks and the claim's own status re-check (`assertNoDrift`), and a claim can never
   * take its locks between the undo's lock check and its status write.
   */
  async touchClaimUndoGuard(stateOid: Types.ObjectId, yearOid: Types.ObjectId, session: ClientSession): Promise<void> {
    try {
      await this.guardModel
        .updateOne({ state: stateOid, year: yearOid }, { $inc: { writes: 1 } }, { upsert: true, session })
        .exec();
    } catch (err) {
      if (WRITE_CONFLICT_CODES.has((err as { code?: number }).code ?? -1)) {
        throw new ConflictException('This state is being updated by another action. Please try again.');
      }
      throw err;
    }
  }

  /**
   * True when the form's latest history entry is PMU's own decision: from `UNDER_REVIEW_BY_PMU` (13) to
   * the status the form is in now. A form that reached 5 by a State submit from before the PMU stage
   * existed logs `2 -> 5` instead, so there is no PMU decision to undo.
   */
  async isPmuDecision(form: PmuUndoForm, currentStatus: number, session?: ClientSession): Promise<boolean> {
    const { model, formField } = this.historyByType[form.type];
    const query = model
      .findOne({ [formField]: form.id })
      .sort({ changedAt: -1, _id: -1 })
      .select('fromStatus toStatus');
    if (session) query.session(session);
    const latest = await query.lean<{ fromStatus?: number | null; toStatus?: number | null } | null>().exec();
    return latest?.fromStatus === FORM_STATUS.UNDER_REVIEW_BY_PMU && latest.toStatus === currentStatus;
  }

  /** Throws 403 when the form's status was not set by a PMU decision (see `isPmuDecision`). */
  async assertPmuDecision(form: PmuUndoForm, currentStatus: number, session?: ClientSession): Promise<void> {
    if (!(await this.isPmuDecision(form, currentStatus, session))) {
      throw new ForbiddenException('This form was not decided by PMU, so there is no PMU decision to undo.');
    }
  }

  /** What the review metadata GET reports as `permissions.canUndo`, so the UI only shows the button when
   *  the endpoint would accept it: the same PMU access gate (`assertPmuReviewerAccess`) and checks. */
  async canUndo(
    user: AuthUser,
    status: number,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    form: PmuUndoForm,
  ): Promise<boolean> {
    if (!hasReviewerAccess(user, Scope.PMU)) return false;
    if (!getEffectivePermissions(user).includes(Permission.APPROVE_STATE_SUBMISSIONS_PMU)) return false;
    if (!canPmuUndoForm(status)) return false;
    if (await this.hasClaimLetterLocks(stateOid, yearOid)) return false;
    return this.isPmuDecision(form, status);
  }
}
