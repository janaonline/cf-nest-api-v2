import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, ClientSession, Model, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import { canStateEditRow } from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import {
  XviFcUnspentStateFormRow,
  XviFcUnspentStateFormRowDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import {
  XviFcUnspentStateFormRowHistory,
  XviFcUnspentStateFormRowHistoryDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row-history.schema';
import {
  DevolutionFormulaRow,
  DevolutionFormulaRowDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import type { XviFcValidationErrorMap } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import type { FcUnspentUlbRowInputDto } from '../../dto/fc-unspent-ulb-row.dto';
import { evaluateRowEligibility, type FcUnspentPolicy } from '../../helpers/fc-unspent-policy.helpers';
import { hasUlbIdentityCode } from '../../helpers/fc-unspent-ulb-code.helpers';
import type {
  FcUnspentActiveRowLean,
  FcUnspentAllocationSourceInput,
  FcUnspentDevolutionFormLean,
  FcUnspentResolvedRow,
  FcUnspentRowStatusTransition,
} from '../../types/fc-unspent-declaration.types';

type FcUnspentDevolutionRowLean = {
  _id: Types.ObjectId;
  ulbId: Types.ObjectId;
  totalGrantAllocation: number;
  installment: 1 | 2;
};

type FcUnspentExistingRowLean = {
  _id: Types.ObjectId;
  ulbId: Types.ObjectId;
  rowStatus: RowReviewStatus | null;
};

/**
 * Owns all persistence for FC Unspent Declaration's per-ULB rows:
 * resolving/validating proposed rows against the Ulb registry and the active
 * Devolution Formula Installment-1 allocation, bulk-upserting the current rows
 * collection (reactivate/deactivate, never hard-delete), and inserting immutable
 * row-history entries only for actual `rowStatus` transitions.
 */
@Injectable()
export class FcUnspentDeclarationRowService {
  constructor(
    @InjectModel(XviFcUnspentStateFormRow.name)
    private readonly rowModel: Model<XviFcUnspentStateFormRowDocument>,
    @InjectModel(XviFcUnspentStateFormRowHistory.name)
    private readonly rowHistoryModel: Model<XviFcUnspentStateFormRowHistoryDocument>,
    @InjectModel(DevolutionFormulaRow.name)
    private readonly devolutionRowModel: Model<DevolutionFormulaRowDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly ulbEligibilityService: UlbEligibilityService,
  ) {}

  /**
   * Resolves each proposed ULB row against the active Ulb registry, rejecting duplicates and
   * computing eligibility server-side from the design year's `policy`. Used by both draft save
   * (partial, may be empty) and final submit (requireAtLeastOne).
   *
   * A draft keeps a selected ULB even before its figures are entered: a `null` amount is accepted and the
   * row is stored incomplete (never eligible, no allocation percent). `requireCompleteRows` (final submit)
   * instead rejects any row missing either amount with a `required` error on that row's field.
   *
   * When `policy.devolutionLinked`, each row is also resolved against the current Devolution Formula
   * Installment-1 allocation (a ULB without a positive allocation is rejected) and `allocationPerc` is
   * computed. Otherwise the form is independent of Devolution: no allocation is looked up, and the
   * allocation fields stay `null`.
   */
  async resolveAndValidateRows(
    stateOid: Types.ObjectId,
    rows: FcUnspentUlbRowInputDto[],
    devolutionForm: FcUnspentDevolutionFormLean | null,
    opts: { requireAtLeastOne: boolean; requireCompleteRows?: boolean; policy: FcUnspentPolicy },
  ): Promise<{ rows: FcUnspentResolvedRow[]; errors: XviFcValidationErrorMap }> {
    const errors: XviFcValidationErrorMap = {};

    if (opts.requireAtLeastOne && rows.length === 0) {
      errors['unspentUlbData'] = [
        { field: 'unspentUlbData', code: 'required', message: 'At least one ULB row is required.' },
      ];
      return { rows: [], errors };
    }

    if (rows.length === 0) return { rows: [], errors };

    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.ulbId)) duplicates.add(row.ulbId);
      seen.add(row.ulbId);
    }
    if (duplicates.size > 0) {
      errors['unspentUlbData'] = [
        { field: 'unspentUlbData', code: 'duplicateUlb', message: 'Duplicate ULB rows are not allowed.' },
      ];
      return { rows: [], errors };
    }

    const ulbOids = rows.map((r) => new Types.ObjectId(r.ulbId));
    // Cantonment Board ULBs are excluded here via the shared eligibility filter — a row for one
    // simply won't resolve, and falls through to the same "ULB not found in registry" handling as
    // any other invalid ulbId.
    const eligibleUlbFilter = await this.ulbEligibilityService.getEligibleUlbFilter(stateOid, 'XVIFC');
    const [ulbDocs, allocationMap] = await Promise.all([
      this.ulbModel
        .find({ ...eligibleUlbFilter, _id: { $in: ulbOids } })
        .select('name censusCode sbCode')
        .lean()
        .exec(),
      opts.policy.devolutionLinked && devolutionForm
        ? this.resolveAllocationsForUlbIds(devolutionForm._id, devolutionForm.activeDatasetVersion, ulbOids)
        : Promise.resolve(new Map<string, FcUnspentAllocationSourceInput>()),
    ]);
    const ulbDocById = new Map(ulbDocs.map((u) => [String(u._id), u]));

    const builtRows: FcUnspentResolvedRow[] = [];
    rows.forEach((row, i) => {
      const path = `unspentUlbData.${i}`;
      const ulb = ulbDocById.get(row.ulbId);
      if (!ulb) {
        errors[`${path}.ulbId`] = [
          { field: `${path}.ulbId`, code: 'ulbNotFound', message: 'ULB not found or not active in this state.' },
        ];
        return;
      }

      if (!hasUlbIdentityCode(ulb)) {
        errors[`${path}.ulbId`] = [
          {
            field: `${path}.ulbId`,
            code: 'ulbCodeMissing',
            message: 'This ULB has no census code or SB code on record, so it cannot be saved.',
          },
        ];
        return;
      }

      const linked = opts.policy.devolutionLinked;
      const allocationSource = linked ? (allocationMap.get(row.ulbId) ?? null) : null;
      const allocationAmount = allocationSource?.allocationAmount ?? null;
      if (linked && (!allocationSource || allocationAmount === null || allocationAmount <= 0)) {
        errors[`${path}.ulbId`] = [
          {
            field: `${path}.ulbId`,
            code: 'noAllocation',
            message: 'No positive Devolution allocation found for this ULB.',
          },
        ];
        return;
      }

      // `undefined` (omitted) is normalised to `null` so a single "not entered yet" value reaches storage.
      const unspentAmount = row.unspentAmount ?? null;
      const previousFcUnspentBalance = row.previousFcUnspentBalance ?? null;

      if (opts.requireCompleteRows) {
        const required: [string, string, number | null][] = [
          ['unspentAmount', 'Unspent amount is required.', unspentAmount],
          ['previousFcUnspentBalance', 'Previous FC unspent balance is required.', previousFcUnspentBalance],
        ];
        let incomplete = false;
        for (const [key, message, value] of required) {
          if (value !== null) continue;
          errors[`${path}.${key}`] = [{ field: `${path}.${key}`, code: 'required', message }];
          incomplete = true;
        }
        if (incomplete) return;
      }

      if (unspentAmount !== null && !(unspentAmount > 0)) {
        errors[`${path}.unspentAmount`] = [
          {
            field: `${path}.unspentAmount`,
            code: 'invalidAmount',
            message: 'Unspent amount must be greater than zero.',
          },
        ];
        return;
      }

      const allocationPerc =
        allocationAmount !== null && unspentAmount !== null ? (unspentAmount / allocationAmount) * 100 : null;
      const eligibility = evaluateRowEligibility(
        opts.policy.eligibilityRule,
        { unspentAmount, previousFcUnspentBalance },
        allocationPerc,
      );

      builtRows.push({
        ulbId: new Types.ObjectId(row.ulbId),
        censusCode: ulb.censusCode ?? '',
        sbCode: ulb.sbCode ?? '',
        ulbName: ulb.name,
        allocationAmount,
        unspentAmount,
        previousFcUnspentBalance,
        allocationPerc,
        eligibility,
        allocationSource,
      });
    });

    return { rows: builtRows, errors };
  }

  /**
   * Bulk-upserts the given resolved rows for a form (keyed by form+ulbId), assigning
   * a deterministic `rowNumber` from submission order, and deactivates any
   * previously-active row omitted from this submission — never hard-deleted, so a
   * later resubmission reactivates the same document. Must run inside the caller's
   * Mongo session.
   *
   * When `targetRowStatus` is provided (final submit), every submitted row's
   * `rowStatus` is forced to that value and the return value's `transitions` lists
   * only the rows whose `rowStatus` actually changed (for row-history insertion).
   * When omitted (draft save), `rowStatus` is left untouched on existing rows and
   * defaults to `null` for newly-inserted ones.
   */
  async applyRows(
    formId: Types.ObjectId,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    resolvedRows: FcUnspentResolvedRow[],
    userOid: Types.ObjectId,
    targetRowStatus: RowReviewStatus | undefined,
    session: ClientSession,
  ): Promise<{ transitions: FcUnspentRowStatusTransition[]; preservedLockedRows: string[] }> {
    const ulbOids = resolvedRows.map((r) => r.ulbId);

    // Always loaded (not just on finalSubmit) — saveDraft needs the same lock protection as
    // finalSubmit: a row PMU has already approved must never be overwritten by either path, since
    // the client's submitted array routinely resends every row, including untouched approved ones.
    const existingRows =
      ulbOids.length > 0
        ? await this.rowModel
            .find({ form: formId, ulbId: { $in: ulbOids } })
            .select('_id ulbId rowStatus')
            .session(session)
            .lean<FcUnspentExistingRowLean[]>()
            .exec()
        : [];
    const existingByUlbId = new Map(existingRows.map((r) => [String(r.ulbId), r]));
    const transitions: FcUnspentRowStatusTransition[] = [];
    const preservedLockedRows: string[] = [];

    // Rows PMU has already approved are dropped from the bulk write entirely — content,
    // rejectionRemark, and rowStatus all stay exactly as stored, regardless of what the client
    // submitted for that ulbId. This is what lets a resubmission fix only the rejected rows without
    // being able to (even accidentally) touch already-approved ones.
    const editableRows = resolvedRows.filter((row) => {
      const existing = existingByUlbId.get(String(row.ulbId));
      const locked = existing !== undefined && !canStateEditRow(existing.rowStatus);
      if (locked) preservedLockedRows.push(String(row.ulbId));
      return !locked;
    });

    if (editableRows.length > 0) {
      const bulkOps: AnyBulkWriteOperation<XviFcUnspentStateFormRowDocument>[] = editableRows.map((row, i) => {
        const setFields: Record<string, unknown> = {
          state: stateOid,
          year: yearOid,
          rowNumber: i + 1,
          censusCode: row.censusCode,
          sbCode: row.sbCode,
          ulbName: row.ulbName,
          allocationAmount: row.allocationAmount,
          unspentAmount: row.unspentAmount,
          previousFcUnspentBalance: row.previousFcUnspentBalance,
          allocationPerc: row.allocationPerc,
          eligibility: row.eligibility,
          allocationSource: row.allocationSource,
          isActive: true,
          updatedBy: userOid,
        };
        // bulkWrite upserts don't reliably apply Mongoose schema defaults on insert —
        // every new-row field must be stamped explicitly rather than relied upon.
        const setOnInsert: Record<string, unknown> = { createdBy: userOid, rejectionRemark: null };
        if (targetRowStatus !== undefined) {
          setFields['rowStatus'] = targetRowStatus;
        } else {
          setOnInsert['rowStatus'] = null;
        }

        return {
          updateOne: {
            filter: { form: formId, ulbId: row.ulbId },
            update: { $set: setFields, $setOnInsert: setOnInsert },
            upsert: true,
          },
        };
      });

      const bulkResult = await this.rowModel.bulkWrite(bulkOps, { session });

      if (targetRowStatus !== undefined) {
        const upsertedIds = (bulkResult.upsertedIds ?? {}) as Record<number, Types.ObjectId>;

        editableRows.forEach((row, i) => {
          const existing = existingByUlbId.get(String(row.ulbId));
          const previousStatus = existing?.rowStatus ?? null;
          if (previousStatus === targetRowStatus) return; // no-op — unchanged, skip history

          const rowId = existing?._id ?? upsertedIds[i];
          transitions.push({
            rowId,
            previousStatus,
            currentStatus: targetRowStatus,
            row: { ...row, rowNumber: i + 1 },
          });
        });
      }
    }

    await this.deactivateOmittedRows(formId, ulbOids, userOid, session);
    return { transitions, preservedLockedRows };
  }

  /** Deactivates every active row for a form (No-branch / branch switch). No rowStatus change, no history. */
  async deactivateAllRows(formId: Types.ObjectId, userOid: Types.ObjectId, session: ClientSession): Promise<void> {
    await this.rowModel
      .updateMany({ form: formId, isActive: true }, { $set: { isActive: false, updatedBy: userOid } }, { session })
      .exec();
  }

  /** Inserts one immutable row-history entry per transition. No-op when there are none. */
  async insertRowHistory(
    formId: Types.ObjectId,
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
    transitions: FcUnspentRowStatusTransition[],
    userOid: Types.ObjectId,
    ip: string | null,
    userAgent: string | null,
    session: ClientSession,
  ): Promise<void> {
    if (transitions.length === 0) return;

    await this.rowHistoryModel.insertMany(
      transitions.map((t) => ({
        row: t.rowId,
        form: formId,
        state: stateOid,
        year: yearOid,
        previousStatus: t.previousStatus,
        currentStatus: t.currentStatus,
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
          allocationSource: t.row.allocationSource,
        },
        createdBy: userOid,
        updatedBy: userOid,
        ipAddress: ip,
        userAgent,
      })),
      { session },
    );
  }

  /**
   * Loads active rows for a form, sorted by rowNumber — used to build both the GET
   * response's `unspentUlbData` and the parent-history snapshot. Pass `session` when
   * called from within a transaction so the read observes uncommitted writes from
   * the same transaction.
   */
  async getActiveRows(formId: Types.ObjectId, session?: ClientSession): Promise<FcUnspentActiveRowLean[]> {
    const query = this.rowModel
      .find({ form: formId, isActive: true })
      .sort({ rowNumber: 1, _id: 1 })
      .select(
        'rowNumber ulbId censusCode sbCode ulbName allocationAmount unspentAmount previousFcUnspentBalance allocationPerc eligibility rowStatus rejectionRemark allocationSource',
      );
    if (session) query.session(session);
    return query.lean<FcUnspentActiveRowLean[]>().exec();
  }

  /** A row PMU has already approved must never be deactivated just because a resubmission's
   *  payload omitted it — the array-diff contract means an omission here is expected to be
   *  read as "not touching this row," never as "remove it." */
  private async deactivateOmittedRows(
    formId: Types.ObjectId,
    submittedUlbIds: Types.ObjectId[],
    userOid: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    await this.rowModel
      .updateMany(
        {
          form: formId,
          isActive: true,
          ulbId: { $nin: submittedUlbIds },
          rowStatus: { $nin: [FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA] },
        },
        { $set: { isActive: false, updatedBy: userOid } },
        { session },
      )
      .exec();
  }

  // Reads devolution-formula's activeDatasetVersion invariant from outside that module — see
  // devolution-formula/docs/adr/0001-dataset-versioning.md before changing either side of this.
  private async resolveAllocationsForUlbIds(
    devolutionFormId: Types.ObjectId,
    activeDatasetVersion: number,
    ulbIds: Types.ObjectId[],
  ): Promise<Map<string, FcUnspentAllocationSourceInput>> {
    const rows = await this.devolutionRowModel
      .find({ form: devolutionFormId, datasetVersion: activeDatasetVersion, isActive: true, ulbId: { $in: ulbIds } })
      .select('ulbId totalGrantAllocation installment')
      .lean<FcUnspentDevolutionRowLean[]>()
      .exec();
    return new Map(
      rows.map((r) => [
        String(r.ulbId),
        {
          devolutionFormId,
          devolutionRowId: r._id,
          datasetVersion: activeDatasetVersion,
          installment: r.installment,
          allocationAmount: r.totalGrantAllocation,
        },
      ]),
    );
  }
}
