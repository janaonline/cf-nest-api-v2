import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import { PmuRowReviewHelper } from 'src/module/xvi-fc/common/services/pmu-row-review.helper';
import {
  FC_UNSPENT_STATE_FORM_TYPE,
  XviFcUnspentStateForm,
  XviFcUnspentStateFormDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import {
  XviFcUnspentStateFormHistory,
  XviFcUnspentStateFormHistoryDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-history.schema';
import {
  XviFcUnspentStateFormRow,
  XviFcUnspentStateFormRowDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import {
  XviFcUnspentStateFormRowHistory,
  XviFcUnspentStateFormRowHistoryDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row-history.schema';
import type {
  FcUnspentPmuFormLean,
  FcUnspentPmuRowLean,
  FcUnspentPmuRowSummary,
  FcUnspentPmuRowTransitionRequest,
} from '../types/fc-unspent-pmu-review.types';

const ROW_LEAN_SELECT =
  'form rowNumber ulbId censusCode sbCode ulbName allocationAmount unspentAmount previousFcUnspentBalance allocationPerc eligibility rowStatus rejectionRemark';

/**
 * Shared PMU-review domain primitives used by both the row-level and complete-form approve/reject
 * flows so the two never diverge. See CLAUDE.md's "PMU vs MoHUA" and "Dependencies" sections for
 * why this operates on the same State-owned collections and hands off to the untouched MoHUA
 * module at UNDER_REVIEW_BY_MOHUA.
 */
@Injectable()
export class FcUnspentPmuRowReviewDomainService {
  constructor(
    @InjectModel(XviFcUnspentStateForm.name)
    private readonly formModel: Model<XviFcUnspentStateFormDocument>,
    @InjectModel(XviFcUnspentStateFormHistory.name)
    private readonly historyModel: Model<XviFcUnspentStateFormHistoryDocument>,
    @InjectModel(XviFcUnspentStateFormRow.name)
    private readonly rowModel: Model<XviFcUnspentStateFormRowDocument>,
    @InjectModel(XviFcUnspentStateFormRowHistory.name)
    private readonly rowHistoryModel: Model<XviFcUnspentStateFormRowHistoryDocument>,
    private readonly pmuReviewHelper: StateFormPmuReviewHelper,
    private readonly pmuRowReviewHelper: PmuRowReviewHelper,
  ) {}

  /** Loads the FC Unspent parent form for a state/year; null if it doesn't exist yet. */
  async findForm(stateId: string, yearId: string): Promise<FcUnspentPmuFormLean | null> {
    return this.formModel
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        formType: FC_UNSPENT_STATE_FORM_TYPE,
        isDeleted: false,
      })
      .lean<FcUnspentPmuFormLean>()
      .exec();
  }

  /** All active rows for a form, sorted by rowNumber. Delegates the mechanical query to the
   *  shared `PmuRowReviewHelper` (identical to Elected Urban Local Bodies' equivalent, minus the
   *  `datasetVersion` filter this form has no concept of). */
  async getActiveRows(formId: Types.ObjectId, session?: ClientSession): Promise<FcUnspentPmuRowLean[]> {
    return this.pmuRowReviewHelper.getActiveRows<XviFcUnspentStateFormRowDocument, FcUnspentPmuRowLean>({
      rowModel: this.rowModel,
      formId,
      select: ROW_LEAN_SELECT,
      session,
    });
  }

  /**
   * Loads the active rows matching the given IDs, scoped to the form. Returns which requested IDs
   * weren't found (foreign-form, inactive, or nonexistent) so callers can produce one field-keyed error.
   */
  async loadActiveRowsByIds(
    formId: Types.ObjectId,
    rowIds: Types.ObjectId[],
  ): Promise<{ rows: FcUnspentPmuRowLean[]; missingIds: string[] }> {
    return this.pmuRowReviewHelper.loadActiveRowsByIds<XviFcUnspentStateFormRowDocument, FcUnspentPmuRowLean>({
      rowModel: this.rowModel,
      formId,
      rowIds,
      select: ROW_LEAN_SELECT,
    });
  }

  filterNotInStatus(rows: FcUnspentPmuRowLean[], expectedStatus: RowReviewStatus): FcUnspentPmuRowLean[] {
    return this.pmuRowReviewHelper.filterNotInStatus(rows, expectedStatus);
  }

  /** One bulkWrite + one insertMany; must run inside the caller's Mongo transaction session. The
   *  row-history snapshot shape stays here (form-specific), not in the shared helper. */
  async transitionRows(
    formId: Types.ObjectId,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    transitions: FcUnspentPmuRowTransitionRequest[],
    userOid: Types.ObjectId,
    ip: string | null,
    userAgent: string | null,
    session: ClientSession,
  ): Promise<void> {
    await this.pmuRowReviewHelper.transitionRows<
      XviFcUnspentStateFormRowDocument,
      XviFcUnspentStateFormRowHistoryDocument,
      FcUnspentPmuRowLean
    >({
      rowModel: this.rowModel,
      rowHistoryModel: this.rowHistoryModel,
      formId,
      stateOid,
      yearOid,
      transitions,
      userOid,
      ip,
      userAgent,
      session,
      buildSnapshot: (row, newStatus, rejectionRemark) => ({
        rowNumber: row.rowNumber,
        ulbId: row.ulbId,
        censusCode: row.censusCode,
        sbCode: row.sbCode,
        ulbName: row.ulbName,
        allocationAmount: row.allocationAmount,
        unspentAmount: row.unspentAmount,
        previousFcUnspentBalance: row.previousFcUnspentBalance,
        allocationPerc: row.allocationPerc,
        eligibility: row.eligibility,
        rowStatus: newStatus,
        rejectionRemark,
      }),
    });
  }

  /** Zero means every active row has reached UNDER_REVIEW_BY_MOHUA, PMU's approval target — see
   *  CLAUDE.md's "PMU vs MoHUA" section. */
  async countActiveRowsNotYetApproved(formId: Types.ObjectId, session?: ClientSession): Promise<number> {
    return this.pmuRowReviewHelper.countActiveRowsNotYetApproved<XviFcUnspentStateFormRowDocument>({
      rowModel: this.rowModel,
      formId,
      session,
    });
  }

  /** Row-status/eligibility counts across all active rows for a form — backs the PMU review GET summary. */
  async getRowSummary(formId: Types.ObjectId): Promise<FcUnspentPmuRowSummary> {
    return this.pmuRowReviewHelper.getRowSummary<XviFcUnspentStateFormRowDocument>({
      rowModel: this.rowModel,
      formId,
      includeEligibilitySplit: true,
    });
  }

  /** Sets the parent's status (+ optional `pmuRemarks`) via the shared `StateFormPmuReviewHelper`
   *  — see that class's own docblock for the migration history. */
  async transitionParent(
    formId: Types.ObjectId,
    toStatus: number,
    pmuRemarks: string | null | undefined,
    newAuditRevision: number,
    userOid: Types.ObjectId,
    session: ClientSession,
  ): Promise<XviFcUnspentStateFormDocument> {
    const setFields: Record<string, unknown> = {
      currentFormStatus: toStatus,
      auditRevision: newAuditRevision,
      updatedBy: userOid,
    };
    if (pmuRemarks !== undefined) setFields['pmuRemarks'] = pmuRemarks;

    return this.pmuReviewHelper.transitionForm<XviFcUnspentStateFormDocument>({
      formModel: this.formModel,
      formId,
      setFields,
      session,
      notFoundMessage: 'FC Unspent Declaration form not found.',
    });
  }

  /** Inserts one parent-history entry, snapshotting active rows — the no-op-skip guard is the
   *  shared `StateFormPmuReviewHelper`'s; the snapshot fetch only runs when a history entry will
   *  actually be written. */
  async insertParentHistory(
    form: FcUnspentPmuFormLean,
    fromStatus: number,
    toStatus: number,
    newAuditRevision: number,
    applicableFc: string,
    userOid: Types.ObjectId,
    ip: string | null,
    userAgent: string | null,
    session: ClientSession,
  ): Promise<void> {
    await this.pmuReviewHelper.writeHistoryIfChanged<XviFcUnspentStateFormHistoryDocument>({
      historyModel: this.historyModel,
      fromStatus,
      toStatus,
      session,
      buildDocument: async () => {
        const activeRows = await this.getActiveRows(form._id, session);
        const snapshot = activeRows.map((row) => ({
          rowNumber: row.rowNumber,
          ulbId: row.ulbId,
          censusCode: row.censusCode,
          sbCode: row.sbCode,
          ulbName: row.ulbName,
          allocationAmount: row.allocationAmount,
          unspentAmount: row.unspentAmount,
          previousFcUnspentBalance: row.previousFcUnspentBalance,
          allocationPerc: row.allocationPerc,
          eligibility: row.eligibility,
          rowStatus: row.rowStatus,
          rejectionRemark: row.rejectionRemark ?? null,
        }));

        return {
          fcUnspentForm: form._id,
          state: form.state,
          year: form.year,
          fromStatus,
          toStatus,
          auditRevision: newAuditRevision,
          applicableFc,
          isFcUnspent: form.isFcUnspent,
          fcDeclaration: form.fcDeclaration ?? null,
          unspentUlbData: snapshot,
          checkboxConfirmation: form.checkboxConfirmation,
          changedBy: userOid,
          changedAt: new Date(),
          ip,
          userAgent,
        };
      },
    });
  }

  /** Atomic with the session — mirrors mohua's `maybeAcknowledgeAfterBulkAction`; settles the
   *  parent once every active row is individually approved. See CLAUDE.md's "Row-level bulk review
   *  and the auto-approve rule" section. */
  async maybeApproveAfterBulkAction(
    form: FcUnspentPmuFormLean,
    applicableFc: string,
    userOid: Types.ObjectId,
    ip: string | null,
    userAgent: string | null,
    session: ClientSession,
  ): Promise<{ approved: boolean; currentFormStatus: number }> {
    const remaining = await this.countActiveRowsNotYetApproved(form._id, session);
    if (remaining > 0) {
      return { approved: false, currentFormStatus: form.currentFormStatus };
    }

    const fromStatus = form.currentFormStatus;
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
    const newAuditRevision = form.auditRevision + 1;

    await this.transitionParent(form._id, toStatus, undefined, newAuditRevision, userOid, session);
    await this.insertParentHistory(
      form,
      fromStatus,
      toStatus,
      newAuditRevision,
      applicableFc,
      userOid,
      ip,
      userAgent,
      session,
    );

    return { approved: true, currentFormStatus: toStatus };
  }
}
