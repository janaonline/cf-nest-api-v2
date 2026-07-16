import type { Types } from 'mongoose';
import type { HydratedFieldConfig } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types';
import type { XvifcFormActor } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import type { ApplicableFc } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import type { RowStatusType } from 'src/common/constants/row-status.constants';

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

export interface FcUnspentDeclarationTemplateResponseData {
  fileName: string;
  mimeType: string;
  url: string;
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
  unspentUlbData: FcUnspentUlbRowResponse[];
}

export interface FcUnspentUlbOption {
  ulbId: string;
  censusCode: string | null;
  sbCode: string | null;
  ulbName: string;
  allocationAmount: number;
}

export interface FcUnspentResolvedAllocation {
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
  rowStatus: RowStatusType | null;
  /**
   * `applyRows` explicitly stamps `null` on every newly-inserted row (bulkWrite upserts
   * don't reliably apply Mongoose schema defaults on insert) — still read this as
   * `row.rejectionRemark ?? null` defensively rather than assuming it's always present.
   */
  rejectionRemark?: string | null;
}

/** One row whose rowStatus actually changed during applyRows — the input to row-history insertion. */
export interface FcUnspentRowStatusTransition {
  rowId: Types.ObjectId;
  previousStatus: RowStatusType | null;
  currentStatus: RowStatusType;
  row: FcUnspentResolvedRow & { rowNumber: number };
}
