import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { FORM_STATUS, FormHistoryAction } from 'src/common/constants/form-status.constants';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import { StateFormPmuReviewHelper } from 'src/module/xvi-fc/common/services/state-form-pmu-review.helper';
import { PmuRowReviewHelper } from 'src/module/xvi-fc/common/services/pmu-row-review.helper';
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

  /** Rows among the given set whose current `rowStatus` isn't `expectedStatus`. */
  filterNotInStatus(rows: EulbPmuRowLean[], expectedStatus: RowReviewStatus): EulbPmuRowLean[] {
    return this.pmuRowReviewHelper.filterNotInStatus(rows, expectedStatus);
  }

  /** One bulkWrite + one insertMany; must run inside the caller's Mongo transaction session. The
   *  row-history snapshot shape stays here (form-specific), not in the shared helper. */
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
        ulbId: row.ulbId,
        censusCode: row.censusCode,
        ulbName: row.ulbName,
        electedBodyStatus: row.electedBodyStatus,
        dateOfConstitution: row.dateOfConstitution,
        dateOfExpiry: row.dateOfExpiry,
        remarks: row.remarks,
        datasetVersion: row.datasetVersion,
        rowStatus: newStatus,
        rejectionRemark,
      }),
    });
  }

  /** Count of active rows (in the active dataset version) whose `rowStatus` isn't yet
   *  `UNDER_REVIEW_BY_MOHUA` (PMU's approval target — PMU has no status of its own once approved)
   *  — zero means the form is fully resolved at the PMU stage. */
  async countActiveRowsNotYetApproved(
    formId: Types.ObjectId,
    datasetVersion: number,
    session?: ClientSession,
  ): Promise<number> {
    return this.pmuRowReviewHelper.countActiveRowsNotYetApproved<EulbRowDocument>({
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

  /** Inserts one parent-history entry, snapshotting the form's active dataset version's active
   *  rows — delegates the no-op-skip-then-create guard to the shared Phase 4 helper; the row
   *  snapshot fetch only runs when a history entry will actually be written. */
  async insertParentHistory(
    form: EulbPmuFormLean,
    fromStatus: number,
    toStatus: number,
    action: FormHistoryAction,
    userOid: Types.ObjectId,
    ip: string | null,
    userAgent: string | null,
    session: ClientSession,
  ): Promise<void> {
    await this.pmuReviewHelper.writeHistoryIfChanged<EulbFormHistoryDocument>({
      historyModel: this.historyModel,
      fromStatus,
      toStatus,
      session,
      buildDocument: async () => {
        const activeRows = await this.getActiveRows(form._id, form.activeDatasetVersion, session);
        const snapshot = activeRows.map((row) => ({
          rowNumber: row.rowNumber,
          ulbId: row.ulbId,
          censusCode: row.censusCode,
          ulbName: row.ulbName,
          electedBodyStatus: row.electedBodyStatus,
          dateOfConstitution: row.dateOfConstitution,
          dateOfExpiry: row.dateOfExpiry,
          remarks: row.remarks,
          datasetVersion: row.datasetVersion,
          rowStatus: row.rowStatus,
          rejectionRemark: row.rejectionRemark ?? null,
        }));

        return {
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
          snapshot,
        };
      },
    });
  }

  /** Atomic with the session — settles the parent at `UNDER_REVIEW_BY_MOHUA` once every active row
   *  (in the active dataset version) is individually approved (PMU has no status of its own once
   *  approved). Mirrors `FcUnspentPmuRowReviewDomainService.maybeApproveAfterBulkAction`. */
  async maybeApproveAfterBulkAction(
    form: EulbPmuFormLean,
    userOid: Types.ObjectId,
    ip: string | null,
    userAgent: string | null,
    session: ClientSession,
  ): Promise<{ approved: boolean; currentFormStatus: number }> {
    const remaining = await this.countActiveRowsNotYetApproved(form._id, form.activeDatasetVersion, session);
    if (remaining > 0) {
      return { approved: false, currentFormStatus: form.currentFormStatus };
    }

    const fromStatus = form.currentFormStatus;
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;

    await this.transitionParent(form._id, toStatus, undefined, userOid, session);
    await this.insertParentHistory(
      form,
      fromStatus,
      toStatus,
      FormHistoryAction.PMU_APPROVE,
      userOid,
      ip,
      userAgent,
      session,
    );

    return { approved: true, currentFormStatus: toStatus };
  }
}
