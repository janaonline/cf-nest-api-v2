import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { FORM_STATUS, FormHistoryAction } from 'src/common/constants/form-status.constants';
import { escapeRegex } from 'src/common/utils/regex.util';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import { PmuRowReviewHelper, resolveSettledFormStatus } from 'src/module/xvi-fc/common/services/pmu-row-review.helper';
import {
  ElectedUrbanLocalBodiesForm,
  EULB_FORM_TYPE,
  EulbFormDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesFormHistory,
  EulbFormHistoryDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form-history.schema';
import {
  ElectedUrbanLocalBodiesRow,
  EulbRowDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import {
  ElectedUrbanLocalBodiesRowHistory,
  EulbRowHistoryDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row-history.schema';
import type {
  EulbPmuFormLean,
  EulbPmuRowLean,
  EulbPmuRowSummary,
  EulbPmuRowTransitionRequest,
} from '../types/elected-urban-local-bodies-pmu-review.types';

const ROW_LEAN_SELECT =
  'form datasetVersion rowNumber ulbId censusCode ulbName electedBodyStatus dateOfConstitution dateOfExpiry remarks rowStatus rejectionRemark';

/**
 * Shared PMU-review domain primitives used by both the row-level and complete-form approve/reject
 * flows so the two never diverge. Modeled on `FcUnspentPmuRowReviewDomainService`
 * (pmu/fc-unspent-declaration), with two differences driven by EULB's own shape: rows are
 * dataset-versioned (every row query is scoped by `datasetVersion`, since Excel re-upload
 * hard-deletes the previous version's rows — see elected-urban-local-bodies/CLAUDE.md), and the
 * complete-form transition/history steps delegate to the shared `StateFormPmuReviewHelper`
 * (Phase 4) instead of hand-rolling them a second time.
 */
@Injectable()
export class ElectedUrbanLocalBodiesPmuRowReviewDomainService {
  constructor(
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly formModel: Model<EulbFormDocument>,
    @InjectModel(ElectedUrbanLocalBodiesFormHistory.name)
    private readonly historyModel: Model<EulbFormHistoryDocument>,
    @InjectModel(ElectedUrbanLocalBodiesRow.name)
    private readonly rowModel: Model<EulbRowDocument>,
    @InjectModel(ElectedUrbanLocalBodiesRowHistory.name)
    private readonly rowHistoryModel: Model<EulbRowHistoryDocument>,
    private readonly pmuReviewHelper: StateFormPmuReviewHelper,
    private readonly pmuRowReviewHelper: PmuRowReviewHelper,
  ) {}

  /** Loads the EULB parent form for a state/year; null if it doesn't exist yet. Filter mirrors
   *  `ElectedUrbanLocalBodiesService.finalSubmit`'s own exactly (no isDeleted/isActive clause). */
  async findForm(stateId: string, yearId: string): Promise<EulbPmuFormLean | null> {
    return this.formModel
      .findOne({ state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId), formType: EULB_FORM_TYPE })
      .select('state year currentFormStatus activeDatasetVersion')
      .lean<EulbPmuFormLean>()
      .exec();
  }

  /** All active rows in the form's active dataset version, sorted by rowNumber. Delegates the
   *  mechanical query to the shared `PmuRowReviewHelper` (identical to FC Unspent's equivalent
   *  modulo the `datasetVersion` filter). */
  async getActiveRows(
    formId: Types.ObjectId,
    datasetVersion: number,
    session?: ClientSession,
  ): Promise<EulbPmuRowLean[]> {
    return this.pmuRowReviewHelper.getActiveRows<EulbRowDocument, EulbPmuRowLean>({
      rowModel: this.rowModel,
      formId,
      datasetVersion,
      select: ROW_LEAN_SELECT,
      session,
    });
  }

  /**
   * Loads the active rows (in the form's active dataset version) matching the given IDs. Returns
   * which requested IDs weren't found (foreign-form, wrong dataset version, inactive, or
   * nonexistent) so callers can produce one field-keyed error.
   */
  async loadActiveRowsByIds(
    formId: Types.ObjectId,
    datasetVersion: number,
    rowIds: Types.ObjectId[],
  ): Promise<{ rows: EulbPmuRowLean[]; missingIds: string[] }> {
    return this.pmuRowReviewHelper.loadActiveRowsByIds<EulbRowDocument, EulbPmuRowLean>({
      rowModel: this.rowModel,
      formId,
      datasetVersion,
      rowIds,
      select: ROW_LEAN_SELECT,
    });
  }

  /** Resolves a "select all matching" bulk action into concrete rows — see
   *  `PmuRowReviewHelper.loadActiveRowsBySelectAllMatching`'s own docblock. Searches the same
   *  `ulbName`/`censusCode` fields `getRows()` does. */
  async loadActiveRowsBySelectAllMatching(
    formId: Types.ObjectId,
    datasetVersion: number,
    requiredStatus: RowReviewStatus,
    search?: string,
    excludeRowIds?: Types.ObjectId[],
  ): Promise<EulbPmuRowLean[]> {
    return this.pmuRowReviewHelper.loadActiveRowsBySelectAllMatching<EulbRowDocument, EulbPmuRowLean>({
      rowModel: this.rowModel,
      formId,
      datasetVersion,
      requiredStatus,
      search,
      excludeRowIds,
      select: ROW_LEAN_SELECT,
      buildSearchFilter: (s) => {
        const regex = new RegExp(escapeRegex(s), 'i');
        return { $or: [{ ulbName: regex }, { censusCode: regex }] };
      },
    });
  }

  /** Rows among the given set whose current `rowStatus` isn't `expectedStatus`. */
  filterNotInStatus(rows: EulbPmuRowLean[], expectedStatus: RowReviewStatus): EulbPmuRowLean[] {
    return this.pmuRowReviewHelper.filterNotInStatus(rows, expectedStatus);
  }

  /** One bulkWrite + one insertMany; must run inside the caller's Mongo transaction session.
   *  Captures each row's post-transition field values (including `rejectionRemark`) into
   *  row-history via `buildSnapshot`, so a rejection's reason survives a later
   *  reject→edit→resubmit cycle even though the live row's own `rejectionRemark` gets
   *  overwritten each time. */
  async transitionRows(
    formId: Types.ObjectId,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    transitions: EulbPmuRowTransitionRequest[],
    userOid: Types.ObjectId,
    ip: string | null,
    userAgent: string | null,
    session: ClientSession,
  ): Promise<void> {
    await this.pmuRowReviewHelper.transitionRows<EulbRowDocument, EulbRowHistoryDocument, EulbPmuRowLean>({
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
        ulbId: row.ulbId ?? null,
        censusCode: row.censusCode ?? null,
        ulbName: row.ulbName,
        electedBodyStatus: row.electedBodyStatus ?? null,
        dateOfConstitution: row.dateOfConstitution ?? null,
        dateOfExpiry: row.dateOfExpiry ?? null,
        remarks: row.remarks ?? null,
        datasetVersion: row.datasetVersion,
        rowStatus: newStatus,
        rejectionRemark,
      }),
    });
  }

  /** Tallies active rows (in the active dataset version) by PMU review stage — see
   *  `PmuRowReviewHelper.getRowStatusTally`'s own docblock. */
  async getRowStatusTally(formId: Types.ObjectId, datasetVersion: number, session?: ClientSession) {
    return this.pmuRowReviewHelper.getRowStatusTally<EulbRowDocument>({
      rowModel: this.rowModel,
      formId,
      datasetVersion,
      session,
    });
  }

  /** Row-status counts across all active rows (in the active dataset version) — backs the PMU
   *  review GET summary. EULB rows have no `eligibility` flag (unlike FC Unspent's), so unlike
   *  `FcUnspentPmuRowSummary` there's no eligible/ineligible split here. */
  async getRowSummary(formId: Types.ObjectId, datasetVersion: number): Promise<EulbPmuRowSummary> {
    return this.pmuRowReviewHelper.getRowSummary<EulbRowDocument>({
      rowModel: this.rowModel,
      formId,
      datasetVersion,
    });
  }

  /** Sets the parent's `currentFormStatus` (+ optional `pmuRemarks`) — delegates the mechanical
   *  $set/NotFoundException guard to the shared Phase 4 helper. */
  async transitionParent(
    formId: Types.ObjectId,
    toStatus: number,
    pmuRemarks: string | null | undefined,
    userOid: Types.ObjectId,
    session: ClientSession,
  ): Promise<EulbFormDocument> {
    const setFields: Record<string, unknown> = { currentFormStatus: toStatus, updatedBy: userOid };
    if (pmuRemarks !== undefined) setFields['pmuRemarks'] = pmuRemarks;

    return this.pmuReviewHelper.transitionForm<EulbFormDocument>({
      formModel: this.formModel,
      formId,
      setFields,
      session,
      notFoundMessage: 'Elected Urban Local Bodies form not found.',
    });
  }

  /** Inserts one parent-history entry — delegates the no-op-skip-then-create guard to the shared
   *  Phase 4 helper. `snapshot`/`data` are left null: a PMU approve/reject never edits form/row
   *  data, and the real snapshot already lives on the FINAL_SUBMIT entry in this same collection —
   *  see common/services/CLAUDE.md's "PMU Review shared mechanics". `remarks` is optional and
   *  trailing so every existing positional call site keeps compiling; only a single-explicit
   *  reject (one unambiguous reason) passes it — see `maybeSettleAfterBulkAction`'s own call. */
  async insertParentHistory(
    form: EulbPmuFormLean,
    fromStatus: number,
    toStatus: number,
    action: FormHistoryAction,
    userOid: Types.ObjectId,
    ip: string | null,
    userAgent: string | null,
    session: ClientSession,
    remarks?: string | null,
  ): Promise<void> {
    await this.pmuReviewHelper.writeHistoryIfChanged<EulbFormHistoryDocument>({
      historyModel: this.historyModel,
      fromStatus,
      toStatus,
      session,
      buildDocument: () => ({
        eulbForm: form._id,
        state: form.state,
        year: form.year,
        action,
        fromStatus,
        toStatus,
        changedBy: userOid,
        changedAt: new Date(),
        ip,
        userAgent,
        snapshot: null,
        remarks: remarks ?? undefined,
      }),
    });
  }

  /** Atomic with the session — settles the parent the instant every active row (in the active
   *  dataset version) has a PMU decision, whether that decision was reached via a bulk-approve or a
   *  bulk-reject call. `UNDER_REVIEW_BY_MOHUA` when every row was approved; `RETURNED_BY_PMU` when at
   *  least one row was rejected (fully-rejected and mixed outcomes both resolve here — see
   *  `resolveSettledFormStatus`). The `FormHistoryAction` tag follows the outcome, not which bulk
   *  action triggered the call, since it has always meant "the fromStatus→toStatus kind," not "which
   *  button was clicked." Mirrors `FcUnspentPmuRowReviewDomainService.maybeSettleAfterBulkAction`. */
  async maybeSettleAfterBulkAction(
    form: EulbPmuFormLean,
    userOid: Types.ObjectId,
    ip: string | null,
    userAgent: string | null,
    session: ClientSession,
  ): Promise<{ settled: boolean; currentFormStatus: number }> {
    const tally = await this.getRowStatusTally(form._id, form.activeDatasetVersion, session);
    const toStatus = resolveSettledFormStatus(tally);
    if (toStatus === null) {
      return { settled: false, currentFormStatus: form.currentFormStatus };
    }

    const fromStatus = form.currentFormStatus;
    const action =
      toStatus === FORM_STATUS.RETURNED_BY_PMU ? FormHistoryAction.PMU_REJECT : FormHistoryAction.PMU_APPROVE;

    await this.transitionParent(form._id, toStatus, undefined, userOid, session);
    // No `remarks` arg: a bulk reject can carry one shared remark or a distinct remark per row, so
    // there's no single value that correctly represents "the" reason for this derived transition.
    await this.insertParentHistory(form, fromStatus, toStatus, action, userOid, ip, userAgent, session);

    return { settled: true, currentFormStatus: toStatus };
  }
}
