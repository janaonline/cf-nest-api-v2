import type { Types } from 'mongoose';
import type { HydratedFieldConfig } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import type { XvifcFormActor } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import type { ApplicableFc } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';

export interface FcUnspentPermissions {
  canView: boolean;
  canEdit: boolean;
  canSaveDraft: boolean;
  canFinalSubmit: boolean;
}

export interface FcUnspentDependency {
  devolutionStatus: number | null;
  devolutionDatasetExists: boolean;
  editableDueToDevolutionReturn: boolean;
  blockingMessage: string | null;
}

/** Gate booleans resolved from the Devolution dependency, before combining with role/status gates. */
export interface FcUnspentDependencyGates {
  dependency: FcUnspentDependency;
  canEditGate: boolean;
  canSaveDraftGate: boolean;
  canFinalSubmitGate: boolean;
  /** The active Installment 1 Devolution Formula form doc, when one exists (for allocation lookups). */
  devolutionForm: FcUnspentDevolutionFormLean | null;
}

export interface FcUnspentDevolutionFormLean {
  _id: Types.ObjectId;
  currentFormStatus: number;
  activeDatasetVersion: number;
}

export interface FcUnspentUlbRowResponse {
  slNo: number;
  ulbId: string;
  censusCode: string | null;
  sbCode: string | null;
  ulbName: string;
  allocationAmount: number;
  unspentAmount: number;
  allocationPerc: number;
  eligibility: boolean;
}

export interface FcUnspentDeclarationGetResponseData {
  stateName: string;
  applicableFc: ApplicableFc;
  threshold: number;
  currentFormStatus: number;
  permissions: FcUnspentPermissions;
  dependency: FcUnspentDependency;
  actors: XvifcFormActor[];
  questions: HydratedFieldConfig[];
  /** DB-driven metadata for the 8 ULB row-table columns (ulbId, unspentAmount, censusCode, sbCode, ulbName, allocationAmount, allocationPerc, eligibility). Metadata only — does not replace FcUnspentDeclarationRowService's own row validation. */
  rowEditFields: FieldConfig[];
  unspentUlbData: FcUnspentUlbRowResponse[];
}

export interface FcUnspentUlbOption {
  ulbId: string;
  censusCode: string | null;
  sbCode: string | null;
  ulbName: string;
  allocationAmount: number;
}

/**
 * Preserves the exact Devolution Formula row a row's `allocationAmount` was resolved from, so a
 * later Devolution rejection/reconciliation can identify affected rows by exact reference rather
 * than only by state/year.
 */
export interface FcUnspentAllocationSourceInput {
  devolutionFormId: Types.ObjectId;
  devolutionRowId: Types.ObjectId;
  datasetVersion: number;
  installment: 1 | 2;
  allocationAmount: number;
}

/** A server-validated, server-computed row ready to be upserted into the row collection. */
export interface FcUnspentResolvedRow {
  ulbId: Types.ObjectId;
  censusCode: string;
  sbCode: string;
  ulbName: string;
  allocationAmount: number;
  unspentAmount: number;
  allocationPerc: number;
  eligibility: boolean;
  allocationSource: FcUnspentAllocationSourceInput;
}

/** Lean projection of an active row document, used to build both the GET response and history snapshots. */
export interface FcUnspentActiveRowLean {
  _id: Types.ObjectId;
  rowNumber: number;
  ulbId: Types.ObjectId;
  censusCode: string;
  sbCode: string;
  ulbName: string;
  allocationAmount: number;
  unspentAmount: number;
  allocationPerc: number;
  eligibility: boolean;
  rowStatus: RowReviewStatus | null;
  /**
   * `applyRows` explicitly stamps `null` on every newly-inserted row (bulkWrite upserts
   * don't reliably apply Mongoose schema defaults on insert) — still read this as
   * `row.rejectionRemark ?? null` defensively rather than assuming it's always present.
   */
  rejectionRemark?: string | null;
  allocationSource?: FcUnspentAllocationSourceInput | null;
}

/** One row whose rowStatus actually changed during applyRows — the input to row-history insertion. */
export interface FcUnspentRowStatusTransition {
  rowId: Types.ObjectId;
  previousStatus: RowReviewStatus | null;
  currentStatus: RowReviewStatus;
  row: FcUnspentResolvedRow & { rowNumber: number };
}
