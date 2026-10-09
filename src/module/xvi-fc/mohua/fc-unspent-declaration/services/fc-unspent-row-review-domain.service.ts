import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, ClientSession, Model, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
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
  FcUnspentMohuaFormLean,
  FcUnspentMohuaRowLean,
  FcUnspentMohuaRowSummary,
  FcUnspentRowTransitionRequest,
} from '../types/fc-unspent-mohua-review.types';

const ROW_LEAN_SELECT =
  'form rowNumber ulbId censusCode sbCode ulbName allocationAmount unspentAmount previousFcUnspentBalance allocationPerc eligibility rowStatus rejectionRemark';

/** Shared MoHUA-review domain primitives used by both the row-level and complete-form approve/
 *  reject flows so the two never diverge. See CLAUDE.md's "Layout" section for the full list of
 *  what lives here and the reserved future integration point. */
@Injectable()
export class FcUnspentRowReviewDomainService {
  constructor(
    @InjectModel(XviFcUnspentStateForm.name)
    private readonly formModel: Model<XviFcUnspentStateFormDocument>,
    @InjectModel(XviFcUnspentStateFormHistory.name)
    private readonly historyModel: Model<XviFcUnspentStateFormHistoryDocument>,
    @InjectModel(XviFcUnspentStateFormRow.name)
    private readonly rowModel: Model<XviFcUnspentStateFormRowDocument>,
    @InjectModel(XviFcUnspentStateFormRowHistory.name)
    private readonly rowHistoryModel: Model<XviFcUnspentStateFormRowHistoryDocument>,
  ) {}

  /** Loads the FC Unspent parent form for a state/year; null if it doesn't exist yet. */
  async findForm(stateId: string, yearId: string): Promise<FcUnspentMohuaFormLean | null> {
    return this.formModel
      .findOne({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        formType: FC_UNSPENT_STATE_FORM_TYPE,
        isDeleted: false,
      })
      .lean<FcUnspentMohuaFormLean>()
      .exec();
  }

  /** All active rows for a form, sorted by rowNumber. */
  async getActiveRows(formId: Types.ObjectId, session?: ClientSession): Promise<FcUnspentMohuaRowLean[]> {
    const query = this.rowModel.find({ form: formId, isActive: true }).sort({ rowNumber: 1 }).select(ROW_LEAN_SELECT);
    if (session) query.session(session);
    return query.lean<FcUnspentMohuaRowLean[]>().exec();
  }

  /**
   * Loads the active rows matching the given IDs, scoped to the form. Returns which requested IDs
   * weren't found (foreign-form, inactive, or nonexistent) so callers can produce one field-keyed error.
   */
  async loadActiveRowsByIds(
    formId: Types.ObjectId,
    rowIds: Types.ObjectId[],
  ): Promise<{ rows: FcUnspentMohuaRowLean[]; missingIds: string[] }> {
    const rows = await this.rowModel
      .find({ _id: { $in: rowIds }, form: formId, isActive: true })
      .select(ROW_LEAN_SELECT)
      .lean<FcUnspentMohuaRowLean[]>()
      .exec();

    const foundIds = new Set(rows.map((r) => String(r._id)));
    const missingIds = rowIds.map((id) => String(id)).filter((id) => !foundIds.has(id));
    return { rows, missingIds };
  }

  /** Rows among the given set whose current `rowStatus` isn't `expectedStatus`. */
  filterNotInStatus(rows: FcUnspentMohuaRowLean[], expectedStatus: RowReviewStatus): FcUnspentMohuaRowLean[] {
    return rows.filter((r) => (r.rowStatus ?? null) !== expectedStatus);
  }

  /** One bulkWrite + one insertMany; must run inside the caller's Mongo transaction session. See
   *  CLAUDE.md's "transitionRows' defensive re-filter..." section for why it re-filters before
   *  writing. */
  async transitionRows(
    formId: Types.ObjectId,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    transitions: FcUnspentRowTransitionRequest[],
    userOid: Types.ObjectId,
    ip: string | null,
    userAgent: string | null,
    session: ClientSession,
  ): Promise<void> {
    const realTransitions = transitions.filter((t) => (t.row.rowStatus ?? null) !== t.newStatus);
    if (realTransitions.length === 0) return;

    const bulkOps: AnyBulkWriteOperation<XviFcUnspentStateFormRowDocument>[] = realTransitions.map((t) => ({
      updateOne: {
        filter: { _id: t.row._id },
        update: {
          $set: { rowStatus: t.newStatus, rejectionRemark: t.rejectionRemark, updatedBy: userOid },
        },
      },
    }));
    await this.rowModel.bulkWrite(bulkOps, { session });

    await this.rowHistoryModel.insertMany(
      realTransitions.map((t) => ({
        row: t.row._id,
        form: formId,
        state: stateOid,
        year: yearOid,
        previousStatus: t.row.rowStatus ?? null,
        currentStatus: t.newStatus,
        snapshot: {
          rowNumber: t.row.rowNumber,
          ulbId: t.row.ulbId,
          censusCode: t.row.censusCode,
          sbCode: t.row.sbCode,
          ulbName: t.row.ulbName,
          allocationAmount: t.row.allocationAmount,
          unspentAmount: t.row.unspentAmount,
          previousFcUnspentBalance: t.row.previousFcUnspentBalance,
          allocationPerc: t.row.allocationPerc,
          eligibility: t.row.eligibility,
          rowStatus: t.newStatus,
          rejectionRemark: t.rejectionRemark,
        },
        createdBy: userOid,
        updatedBy: userOid,
        ipAddress: ip,
        userAgent,
      })),
      { session },
    );
  }

  /** Count of active rows whose `rowStatus` isn't yet `ACTIVE` — zero means the Yes-branch form is fully resolved. */
  async countActiveRowsNotYetActive(formId: Types.ObjectId, session?: ClientSession): Promise<number> {
    const query = this.rowModel.countDocuments({
      form: formId,
      isActive: true,
      rowStatus: { $ne: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA },
    });
    if (session) query.session(session);
    return query.exec();
  }

  /** Row-status/eligibility counts across all active rows for a form — backs the MoHUA review GET summary. */
  async getRowSummary(formId: Types.ObjectId): Promise<FcUnspentMohuaRowSummary> {
    const rows = await this.rowModel
      .find({ form: formId, isActive: true })
      .select('rowStatus eligibility')
      .lean<{ rowStatus: RowReviewStatus | null; eligibility: boolean }[]>()
      .exec();

    const summary: FcUnspentMohuaRowSummary = {
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
      if (row.eligibility) summary.eligible += 1;
      else summary.ineligible += 1;

      switch (row.rowStatus) {
        case FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA:
          summary.active += 1;
          break;
        case FORM_STATUS.UNDER_REVIEW_BY_MOHUA:
          summary.updatePending += 1;
          break;
        case FORM_STATUS.RETURNED_BY_MOHUA:
          summary.rejected += 1;
          break;
        case FORM_STATUS.ACTION_REQUIRED:
          summary.needsUpdate += 1;
          break;
        default:
          break;
      }
    }

    return summary;
  }

  /** Sets the parent's `currentFormStatus` (+ optional `mohuaRemarks`) to an explicit new audit revision. */
  async transitionParent(
    formId: Types.ObjectId,
    toStatus: number,
    mohuaRemarks: string | null | undefined,
    newAuditRevision: number,
    userOid: Types.ObjectId,
    session: ClientSession,
  ): Promise<XviFcUnspentStateFormDocument> {
    const setDoc: Record<string, unknown> = {
      currentFormStatus: toStatus,
      auditRevision: newAuditRevision,
      updatedBy: userOid,
    };
    if (mohuaRemarks !== undefined) setDoc['mohuaRemarks'] = mohuaRemarks;

    const updated = await this.formModel
      .findOneAndUpdate({ _id: formId }, { $set: setDoc }, { new: true, session })
      .exec();
    if (!updated) throw new NotFoundException('FC Unspent Declaration form not found.');
    return updated;
  }

  /** Inserts one parent-history entry, snapshotting the form's current active rows. See CLAUDE.md's
   *  "transitionRows' defensive re-filter..." section for why this no-ops on `fromStatus === toStatus`. */
  async insertParentHistory(
    form: FcUnspentMohuaFormLean,
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
    if (fromStatus === toStatus) return;

    await this.historyModel.create(
      [
        {
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
        },
      ],
      { session },
    );
  }

  /** Atomic with the session. See CLAUDE.md's "Row-level bulk review and the auto-acknowledge
   *  rule" section for exactly when this does (and permanently doesn't) acknowledge the parent. */
  async maybeAcknowledgeAfterBulkAction(
    form: FcUnspentMohuaFormLean,
    applicableFc: string,
    userOid: Types.ObjectId,
    ip: string | null,
    userAgent: string | null,
    session: ClientSession,
  ): Promise<{ acknowledged: boolean; currentFormStatus: number }> {
    const remaining = await this.countActiveRowsNotYetActive(form._id, session);
    if (remaining > 0) {
      return { acknowledged: false, currentFormStatus: form.currentFormStatus };
    }

    const fromStatus = form.currentFormStatus;
    const toStatus = FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA;
    const newAuditRevision = form.auditRevision + 1;

    await this.transitionParent(form._id, toStatus, undefined, newAuditRevision, userOid, session);
    // No `remarks` arg: this is an auto-acknowledge, not an explicit single-reason action.
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

    return { acknowledged: true, currentFormStatus: toStatus };
  }
}
