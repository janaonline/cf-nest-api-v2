import { Injectable } from '@nestjs/common';
import type { AnyBulkWriteOperation, ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { RowReviewStatus } from '../constants/row-review-status.constants';
import type { PmuRowSummaryCore, PmuRowSummaryWithEligibility } from '../types/pmu-row-summary.type';

interface PmuRowBase {
  _id: Types.ObjectId;
  rowStatus: RowReviewStatus | null;
}

export interface GetActiveRowsParams<TRowDoc> {
  rowModel: Model<TRowDoc>;
  formId: Types.ObjectId;
  /** Omit for forms with no dataset-version concept (FC Unspent Declaration); set for
   *  dataset-versioned rows (Elected Urban Local Bodies) to additionally filter `{ datasetVersion }`. */
  datasetVersion?: number;
  select: string;
  session?: ClientSession;
}

export interface LoadActiveRowsByIdsParams<TRowDoc> extends GetActiveRowsParams<TRowDoc> {
  rowIds: Types.ObjectId[];
}

export interface LoadActiveRowsBySelectAllMatchingParams<TRowDoc> extends GetActiveRowsParams<TRowDoc> {
  /** Bulk actions only ever target rows still awaiting that action — not a free-form filter. */
  requiredStatus: RowReviewStatus;
  excludeRowIds?: Types.ObjectId[];
  search?: string;
  /** Builds the form-specific $or search clause using the same fields as getRows().
Searchable fields vary by form and are provided by the caller.
Skipped when search is absent. */
  buildSearchFilter: (search: string) => Record<string, unknown>;
}

export interface RowTransition<TRow extends PmuRowBase> {
  row: TRow;
  newStatus: RowReviewStatus;
  rejectionRemark: string | null;
}

export interface TransitionPmuRowsParams<TRowDoc, THistoryDoc, TRow extends PmuRowBase> {
  rowModel: Model<TRowDoc>;
  rowHistoryModel: Model<THistoryDoc>;
  formId: Types.ObjectId;
  stateOid: Types.ObjectId;
  yearOid: Types.ObjectId;
  transitions: RowTransition<TRow>[];
  userOid: Types.ObjectId;
  ip: string | null;
  userAgent: string | null;
  session: ClientSession;
  /** Builds the row-history document's `snapshot` payload — field names/values are form-specific
   *  (Elected Urban Local Bodies' electedBodyStatus/dateOfConstitution vs FC Unspent's
   *  allocationAmount/eligibility). Omit for a pure review decision (no data-edit capability exists
   *  at this layer — see common/services/CLAUDE.md's "PMU Review shared mechanics"); `snapshot` is
   *  written `null` when omitted. */
  buildSnapshot?: (row: TRow, newStatus: RowReviewStatus, rejectionRemark: string | null) => Record<string, unknown>;
}

export interface GetRowStatusTallyParams<TRowDoc> {
  rowModel: Model<TRowDoc>;
  formId: Types.ObjectId;
  datasetVersion?: number;
  session?: ClientSession;
}

/** Three-way split of a form's active rows by where each stands in the PMU review stage. */
export interface RowStatusTally {
  /** Still `UNDER_REVIEW_BY_PMU` — PMU hasn't decided this row yet. */
  pending: number;
  /** `UNDER_REVIEW_BY_MOHUA` — PMU has no terminal status of its own, so an approved row lands
   *  directly here. */
  approved: number;
  /** `RETURNED_BY_PMU`. */
  rejected: number;
}

export interface GetRowSummaryParams<TRowDoc> {
  rowModel: Model<TRowDoc>;
  formId: Types.ObjectId;
  datasetVersion?: number;
  includeEligibilitySplit?: boolean;
}

/**
 * Pure function (no DB access, trivially unit-testable): decides the settled form-level outcome from
 * a row-status tally, or `null` when row review isn't complete yet. A rejected row and an approved
 * row can coexist — the mixed outcome resolves to `RETURNED_BY_PMU`, the same target a fully-rejected
 * outcome already used, since both mean "the State has at least one row to act on." This is what lets
 * row review settle after *either* a bulk-approve or a bulk-reject call, instead of only ever being
 * reachable via an all-rows-approved bulk-approve the way the old count-based check required.
 */
export function resolveSettledFormStatus(tally: RowStatusTally): number | null {
  if (tally.pending > 0) return null;
  return tally.rejected > 0 ? FORM_STATUS.RETURNED_BY_PMU : FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
}

/**
 * Row-bulk PMU review mechanics shared by the 2 row-bearing PMU modules (Elected Urban Local
 * Bodies, FC Unspent Declaration). A sibling to `StateFormPmuReviewHelper`, not an extension of it.
 * Full rationale (what's deliberately excluded and why): see common/services/CLAUDE.md's "PMU
 * Review shared mechanics" section.
 */
@Injectable()
export class PmuRowReviewHelper {
  async getActiveRows<TRowDoc, TRow>(params: GetActiveRowsParams<TRowDoc>): Promise<TRow[]> {
    const filter = { form: params.formId, isActive: true } as FilterQuery<TRowDoc>;
    if (params.datasetVersion !== undefined) {
      (filter as Record<string, unknown>)['datasetVersion'] = params.datasetVersion;
    }
    const query = params.rowModel.find(filter).sort({ rowNumber: 1 }).select(params.select);
    if (params.session) query.session(params.session);
    return query.lean<TRow[]>().exec();
  }

  /**
   * Loads the active rows matching the given IDs, scoped to the form (and dataset version, when
   * given). Returns which requested IDs weren't found so callers can produce one field-keyed error.
   */
  async loadActiveRowsByIds<TRowDoc, TRow extends { _id: Types.ObjectId }>(
    params: LoadActiveRowsByIdsParams<TRowDoc>,
  ): Promise<{ rows: TRow[]; missingIds: string[] }> {
    const filter = { _id: { $in: params.rowIds }, form: params.formId, isActive: true } as FilterQuery<TRowDoc>;
    if (params.datasetVersion !== undefined) {
      (filter as Record<string, unknown>)['datasetVersion'] = params.datasetVersion;
    }
    const rows = await params.rowModel.find(filter).select(params.select).lean<TRow[]>().exec();

    const foundIds = new Set(rows.map((r) => String(r._id)));
    const missingIds = params.rowIds.map((id) => String(id)).filter((id) => !foundIds.has(id));
    return { rows, missingIds };
  }

  /**
   * Resolves "select all matching" into concrete rows at execution time — the production-grade
   * alternative to a client enumerating every row id across pages. Always scoped to
   * `requiredStatus` (bulk actions only ever target rows still awaiting that action) and
   * `isActive`, minus any manually-excluded rows, using the same search filter `getRows()` already
   * applies. No pagination here — every matching row is resolved in one query, since the whole
   * point is a single bulk write regardless of how many rows match.
   */
  async loadActiveRowsBySelectAllMatching<TRowDoc, TRow>(
    params: LoadActiveRowsBySelectAllMatchingParams<TRowDoc>,
  ): Promise<TRow[]> {
    const filter: Record<string, unknown> = {
      form: params.formId,
      isActive: true,
      rowStatus: params.requiredStatus,
    };
    if (params.datasetVersion !== undefined) filter['datasetVersion'] = params.datasetVersion;
    if (params.excludeRowIds?.length) filter['_id'] = { $nin: params.excludeRowIds };
    if (params.search) Object.assign(filter, params.buildSearchFilter(params.search));

    const query = params.rowModel.find(filter as FilterQuery<TRowDoc>).select(params.select);
    if (params.session) query.session(params.session);
    return query.lean<TRow[]>().exec();
  }

  /** Rows among the given set whose current `rowStatus` isn't `expectedStatus`. */
  filterNotInStatus<TRow extends PmuRowBase>(rows: TRow[], expectedStatus: RowReviewStatus): TRow[] {
    return rows.filter((r) => (r.rowStatus ?? null) !== expectedStatus);
  }

  /** One bulkWrite + one insertMany; must run inside the caller's Mongo transaction session.
   *  Skips entirely (no DB calls) when every requested transition is already a no-op. */
  async transitionRows<TRowDoc extends Document, THistoryDoc, TRow extends PmuRowBase>(
    params: TransitionPmuRowsParams<TRowDoc, THistoryDoc, TRow>,
  ): Promise<void> {
    const real = params.transitions.filter((t) => (t.row.rowStatus ?? null) !== t.newStatus);
    if (real.length === 0) return;

    const bulkOps = real.map((t) => ({
      updateOne: {
        filter: { _id: t.row._id },
        update: { $set: { rowStatus: t.newStatus, rejectionRemark: t.rejectionRemark, updatedBy: params.userOid } },
      },
    })) as unknown as AnyBulkWriteOperation<TRowDoc>[];
    await params.rowModel.bulkWrite(bulkOps, { session: params.session });

    await params.rowHistoryModel.insertMany(
      real.map((t) => ({
        row: t.row._id,
        form: params.formId,
        state: params.stateOid,
        year: params.yearOid,
        previousStatus: t.row.rowStatus ?? null,
        currentStatus: t.newStatus,
        snapshot: params.buildSnapshot ? params.buildSnapshot(t.row, t.newStatus, t.rejectionRemark) : null,
        createdBy: params.userOid,
        updatedBy: params.userOid,
        ipAddress: params.ip,
        userAgent: params.userAgent,
      })),
      { session: params.session },
    );
  }

  /**
   * Tallies a form's active rows by PMU review stage — the basis for deciding whether row review
   * has *completed* (zero `pending`) and, if so, what the form-level outcome is (see
   * `resolveSettledFormStatus`). Replaces the old `countActiveRowsNotYetApproved`, which only ever
   * asked "how many rows aren't approved yet" — a question that can never reach zero once any row
   * is rejected, which was the deadlock this tally exists to fix.
   */
  async getRowStatusTally<TRowDoc>(params: GetRowStatusTallyParams<TRowDoc>): Promise<RowStatusTally> {
    const filter = { form: params.formId, isActive: true } as FilterQuery<TRowDoc>;
    if (params.datasetVersion !== undefined) {
      (filter as Record<string, unknown>)['datasetVersion'] = params.datasetVersion;
    }
    const query = params.rowModel.find(filter).select('rowStatus');
    if (params.session) query.session(params.session);
    const rows = await query.lean<{ rowStatus: RowReviewStatus | null }[]>().exec();

    const tally: RowStatusTally = { pending: 0, approved: 0, rejected: 0 };
    for (const row of rows) {
      if (row.rowStatus === FORM_STATUS.UNDER_REVIEW_BY_PMU) tally.pending += 1;
      else if (row.rowStatus === FORM_STATUS.RETURNED_BY_PMU) tally.rejected += 1;
      else if (row.rowStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA) tally.approved += 1;
    }
    return tally;
  }

  /** Row-status counts across all active rows for a form, optionally with an eligible/ineligible
   *  split (FC Unspent Declaration only — Elected Urban Local Bodies rows have no `eligibility`
   *  field). The `select` projection is derived from the same `includeEligibilitySplit` flag that
   *  drives the tally, in this one place, so the two can't drift out of sync. */
  async getRowSummary<TRowDoc>(
    params: GetRowSummaryParams<TRowDoc> & { includeEligibilitySplit: true },
  ): Promise<PmuRowSummaryWithEligibility>;
  async getRowSummary<TRowDoc>(
    params: GetRowSummaryParams<TRowDoc> & { includeEligibilitySplit?: false },
  ): Promise<PmuRowSummaryCore>;
  async getRowSummary<TRowDoc>(
    params: GetRowSummaryParams<TRowDoc>,
  ): Promise<PmuRowSummaryCore | PmuRowSummaryWithEligibility> {
    const filter = { form: params.formId, isActive: true } as FilterQuery<TRowDoc>;
    if (params.datasetVersion !== undefined) {
      (filter as Record<string, unknown>)['datasetVersion'] = params.datasetVersion;
    }
    const select = params.includeEligibilitySplit ? 'rowStatus eligibility' : 'rowStatus';
    const rows = await params.rowModel
      .find(filter)
      .select(select)
      .lean<{ rowStatus: RowReviewStatus | null; eligibility?: boolean }[]>()
      .exec();

    const summary: PmuRowSummaryWithEligibility = {
      total: 0,
      active: 0,
      updatePending: 0,
      rejected: 0,
      needsUpdate: 0,
      eligible: 0,
      ineligible: 0,
    };

    for (const row of rows) {
      summary.total += 1;
      if (params.includeEligibilitySplit) {
        if (row.eligibility) summary.eligible += 1;
        else summary.ineligible += 1;
      }
      switch (row.rowStatus) {
        case FORM_STATUS.UNDER_REVIEW_BY_MOHUA:
          summary.active += 1;
          break;
        case FORM_STATUS.UNDER_REVIEW_BY_PMU:
          summary.updatePending += 1;
          break;
        case FORM_STATUS.RETURNED_BY_PMU:
          summary.rejected += 1;
          break;
        case FORM_STATUS.ACTION_REQUIRED:
          summary.needsUpdate += 1;
          break;
        default:
          break;
      }
    }

    if (!params.includeEligibilitySplit) {
      const { total, active, updatePending, rejected, needsUpdate } = summary;
      return { total, active, updatePending, rejected, needsUpdate };
    }
    return summary;
  }
}
