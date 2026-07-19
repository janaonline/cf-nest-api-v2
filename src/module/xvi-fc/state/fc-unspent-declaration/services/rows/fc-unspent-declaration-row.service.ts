import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, ClientSession, Model, Types } from 'mongoose';
import type { RowStatusType } from 'src/common/constants/row-status.constants';
import { FC_UNSPENT_ELIGIBILITY_THRESHOLD_PERCENT } from '../../constants/fc-unspent-declaration.constants';
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
import type { XviFcValidationErrorMap } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import type { FcUnspentUlbRowInputDto } from '../../dto/fc-unspent-ulb-row.dto';
import type {
  FcUnspentActiveRowLean,
  FcUnspentDevolutionFormLean,
  FcUnspentResolvedRow,
  FcUnspentRowStatusTransition,
} from '../../types/fc-unspent-declaration.types';

type FcUnspentDevolutionRowLean = {
  ulbId: Types.ObjectId;
  totalGrantAllocation: number;
};

type FcUnspentExistingRowLean = {
  _id: Types.ObjectId;
  ulbId: Types.ObjectId;
  rowStatus: RowStatusType | null;
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
  ) {}

  /**
   * Resolves each proposed ULB row against the active Ulb registry and the current
   * Devolution Formula Installment-1 allocation, rejecting duplicates and computing
   * allocationPerc/eligibility server-side. Used by both draft save (partial, may be
   * empty) and final submit (requireAtLeastOne).
   */
  async resolveAndValidateRows(
    stateOid: Types.ObjectId,
    rows: FcUnspentUlbRowInputDto[],
    devolutionForm: FcUnspentDevolutionFormLean | null,
    opts: { requireAtLeastOne: boolean },
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
    const [ulbDocs, allocationMap] = await Promise.all([
      this.ulbModel
        .find({ _id: { $in: ulbOids }, state: stateOid, isActive: true })
        .select('name censusCode sbCode')
        .lean()
        .exec(),
      devolutionForm
        ? this.resolveAllocationsForUlbIds(devolutionForm._id, devolutionForm.activeDatasetVersion, ulbOids)
        : Promise.resolve(new Map<string, number>()),
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

      const allocationAmount = allocationMap.get(row.ulbId) ?? 0;
      if (allocationAmount <= 0) {
        errors[`${path}.ulbId`] = [
          {
            field: `${path}.ulbId`,
            code: 'noAllocation',
            message: 'No positive Devolution allocation found for this ULB.',
          },
        ];
        return;
      }

      if (!(row.unspentAmount > 0)) {
        errors[`${path}.unspentAmount`] = [
          {
            field: `${path}.unspentAmount`,
            code: 'invalidAmount',
            message: 'Unspent amount must be greater than zero.',
          },
        ];
        return;
      }

      const allocationPerc = (row.unspentAmount / allocationAmount) * 100;
      const eligibility = allocationPerc <= FC_UNSPENT_ELIGIBILITY_THRESHOLD_PERCENT;

      builtRows.push({
        ulbId: new Types.ObjectId(row.ulbId),
        censusCode: ulb.censusCode ?? '',
        sbCode: ulb.sbCode ?? '',
        ulbName: ulb.name,
        allocationAmount,
        unspentAmount: row.unspentAmount,
        allocationPerc,
        eligibility,
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
    targetRowStatus: RowStatusType | undefined,
    session: ClientSession,
  ): Promise<{ transitions: FcUnspentRowStatusTransition[] }> {
    const ulbOids = resolvedRows.map((r) => r.ulbId);

    const existingRows =
      targetRowStatus !== undefined && ulbOids.length > 0
        ? await this.rowModel
            .find({ form: formId, ulbId: { $in: ulbOids } })
            .select('_id ulbId rowStatus')
            .session(session)
            .lean<FcUnspentExistingRowLean[]>()
            .exec()
        : [];
    const existingByUlbId = new Map(existingRows.map((r) => [String(r.ulbId), r]));
    const transitions: FcUnspentRowStatusTransition[] = [];

    if (resolvedRows.length > 0) {
      const bulkOps: AnyBulkWriteOperation<XviFcUnspentStateFormRowDocument>[] = resolvedRows.map((row, i) => {
        const setFields: Record<string, unknown> = {
          state: stateOid,
          year: yearOid,
          rowNumber: i + 1,
          censusCode: row.censusCode,
          sbCode: row.sbCode,
          ulbName: row.ulbName,
          allocationAmount: row.allocationAmount,
          unspentAmount: row.unspentAmount,
          allocationPerc: row.allocationPerc,
          eligibility: row.eligibility,
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

        resolvedRows.forEach((row, i) => {
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
    return { transitions };
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
          allocationPerc: t.row.allocationPerc,
          eligibility: t.row.eligibility,
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
        'rowNumber ulbId censusCode sbCode ulbName allocationAmount unspentAmount allocationPerc eligibility rowStatus rejectionRemark',
      );
    if (session) query.session(session);
    return query.lean<FcUnspentActiveRowLean[]>().exec();
  }

  private async deactivateOmittedRows(
    formId: Types.ObjectId,
    submittedUlbIds: Types.ObjectId[],
    userOid: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    await this.rowModel
      .updateMany(
        { form: formId, isActive: true, ulbId: { $nin: submittedUlbIds } },
        { $set: { isActive: false, updatedBy: userOid } },
        { session },
      )
      .exec();
  }

  private async resolveAllocationsForUlbIds(
    devolutionFormId: Types.ObjectId,
    activeDatasetVersion: number,
    ulbIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    const rows = await this.devolutionRowModel
      .find({ form: devolutionFormId, datasetVersion: activeDatasetVersion, isActive: true, ulbId: { $in: ulbIds } })
      .select('ulbId totalGrantAllocation')
      .lean<FcUnspentDevolutionRowLean[]>()
      .exec();
    return new Map(rows.map((r) => [String(r.ulbId), r.totalGrantAllocation]));
  }
}
