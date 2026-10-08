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
   *  allocationAmount/eligibility). Only invoked for rows whose status is actually changing. */
  buildSnapshot: (row: TRow, newStatus: RowReviewStatus, rejectionRemark: string | null) => Record<string, unknown>;
}

export interface CountActiveRowsNotYetApprovedParams<TRowDoc> {
  rowModel: Model<TRowDoc>;
  formId: Types.ObjectId;
  datasetVersion?: number;
  /** Defaults to UNDER_REVIEW_BY_MOHUA — PMU's universal approval target for both row-bearing
   *  forms today (PMU has no status of its own once approved). */
  approvedStatus?: number;
  session?: ClientSession;
}

export interface GetRowSummaryParams<TRowDoc> {
  rowModel: Model<TRowDoc>;
  formId: Types.ObjectId;
  datasetVersion?: number;
  includeEligibilitySplit?: boolean;
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
        snapshot: params.buildSnapshot(t.row, t.newStatus, t.rejectionRemark),
        createdBy: params.userOid,
        updatedBy: params.userOid,
        ipAddress: params.ip,
        userAgent: params.userAgent,
      })),
      { session: params.session },
    );
  }

  async countActiveRowsNotYetApproved<TRowDoc>(params: CountActiveRowsNotYetApprovedParams<TRowDoc>): Promise<number> {
    const filter = {
      form: params.formId,
      isActive: true,
      rowStatus: { $ne: params.approvedStatus ?? FORM_STATUS.UNDER_REVIEW_BY_MOHUA },
    } as FilterQuery<TRowDoc>;
    if (params.datasetVersion !== undefined) {
      (filter as Record<string, unknown>)['datasetVersion'] = params.datasetVersion;
    }
    const query = params.rowModel.countDocuments(filter);
    if (params.session) query.session(params.session);
    return query.exec();
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
