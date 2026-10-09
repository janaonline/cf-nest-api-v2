import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import { PmuRowReviewHelper, resolveSettledFormStatus } from 'src/module/xvi-fc/common/services/pmu-row-review.helper';
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

  /** Resolves a "select all matching" bulk action into concrete rows — see
   *  `PmuRowReviewHelper.loadActiveRowsBySelectAllMatching`'s own docblock. Searches the same
   *  `ulbName`/`censusCode`/`sbCode` fields `getRows()` does. */
  async loadActiveRowsBySelectAllMatching(
    formId: Types.ObjectId,
    requiredStatus: RowReviewStatus,
    search?: string,
    excludeRowIds?: Types.ObjectId[],
  ): Promise<FcUnspentPmuRowLean[]> {
    return this.pmuRowReviewHelper.loadActiveRowsBySelectAllMatching<
      XviFcUnspentStateFormRowDocument,
      FcUnspentPmuRowLean
    >({
      rowModel: this.rowModel,
      formId,
      requiredStatus,
      search,
      excludeRowIds,
      select: ROW_LEAN_SELECT,
      buildSearchFilter: (s) => {
        const regex = new RegExp(s, 'i');
        return { $or: [{ ulbName: regex }, { censusCode: regex }, { sbCode: regex }] };
      },
    });
  }

  filterNotInStatus(rows: FcUnspentPmuRowLean[], expectedStatus: RowReviewStatus): FcUnspentPmuRowLean[] {
    return this.pmuRowReviewHelper.filterNotInStatus(rows, expectedStatus);
  }

  /** One bulkWrite + one insertMany; must run inside the caller's Mongo transaction session.
   *  Captures each row's post-transition field values (including `rejectionRemark`) into
   *  row-history via `buildSnapshot`, so a rejection's reason survives a later
   *  reject→edit→resubmit cycle even though the live row's own `rejectionRemark` gets
   *  overwritten each time. `allocationSource` isn't in `ROW_LEAN_SELECT` and is left to its
   *  schema default (null) here — it's only meaningful for the STATE's own FINAL_SUBMIT
   *  snapshot (`FcUnspentDeclarationRowService.insertRowHistory`), not a PMU review decision. */
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

  /** Tallies active rows by PMU review stage — see `PmuRowReviewHelper.getRowStatusTally`'s own
   *  docblock. */
  async getRowStatusTally(formId: Types.ObjectId, session?: ClientSession) {
    return this.pmuRowReviewHelper.getRowStatusTally<XviFcUnspentStateFormRowDocument>({
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

  /** Inserts one parent-history entry — the no-op-skip guard is the shared
   *  `StateFormPmuReviewHelper`'s. `snapshot` is left `[]`: a PMU approve/reject never edits row
   *  data, and the real row-data snapshot already lives on the FINAL_SUBMIT entry in this same
   *  collection — see common/services/CLAUDE.md's "PMU Review shared mechanics". `data` DOES get
   *  resnapshotted here (pre-existing behavior, kept as-is — see Part 2's plan "Decisions" note on
   *  why FC Unspent's PMU/MoHUA stage isn't made to omit it like the other 4 forms). `remarks` is
   *  optional and trailing so every existing positional call site keeps compiling; only a
   *  single-explicit reject (one unambiguous reason) passes it. */
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
    remarks?: string | null,
  ): Promise<void> {
    await this.pmuReviewHelper.writeHistoryIfChanged<XviFcUnspentStateFormHistoryDocument>({
      historyModel: this.historyModel,
      fromStatus,
      toStatus,
      session,
      buildDocument: () => ({
        fcUnspentForm: form._id,
        state: form.state,
        year: form.year,
        fromStatus,
        toStatus,
        auditRevision: newAuditRevision,
        applicableFc,
        data: {
          isFcUnspent: form.isFcUnspent,
          fcDeclaration: form.fcDeclaration ?? null,
          fcUnspentDeclaration: form.fcUnspentDeclaration ?? null,
          checkboxConfirmation: form.checkboxConfirmation,
        },
        snapshot: [],
        remarks: remarks ?? undefined,
        changedBy: userOid,
        changedAt: new Date(),
        ip,
        userAgent,
      }),
    });
  }

  /** Atomic with the session — settles the parent the instant every active row has a PMU decision,
   *  whether that decision was reached via a bulk-approve or a bulk-reject call.
   *  `UNDER_REVIEW_BY_MOHUA` when every row was approved; `RETURNED_BY_PMU` when at least one row was
   *  rejected (fully-rejected and mixed outcomes both resolve here — see `resolveSettledFormStatus`).
   *  Mirrors `ElectedUrbanLocalBodiesPmuRowReviewDomainService.maybeSettleAfterBulkAction`; see also
   *  CLAUDE.md's "Row-level bulk review and the auto-approve rule" section. */
  async maybeSettleAfterBulkAction(
    form: FcUnspentPmuFormLean,
    applicableFc: string,
    userOid: Types.ObjectId,
    ip: string | null,
    userAgent: string | null,
    session: ClientSession,
  ): Promise<{ settled: boolean; currentFormStatus: number }> {
    const tally = await this.getRowStatusTally(form._id, session);
    const toStatus = resolveSettledFormStatus(tally);
    if (toStatus === null) {
      return { settled: false, currentFormStatus: form.currentFormStatus };
    }

    const fromStatus = form.currentFormStatus;
    const newAuditRevision = form.auditRevision + 1;

    await this.transitionParent(form._id, toStatus, undefined, newAuditRevision, userOid, session);
    // No `remarks` arg: a bulk reject can carry one shared remark or a distinct remark per row, so
    // there's no single value that correctly represents "the" reason for this derived transition.
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

    return { settled: true, currentFormStatus: toStatus };
  }
}
