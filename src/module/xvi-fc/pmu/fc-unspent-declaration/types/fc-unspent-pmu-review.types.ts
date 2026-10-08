import type { Types } from 'mongoose';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import type { XvifcFormActor } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import type { HydratedFieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import type { ApplicableFc } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import type { PmuRowSummaryWithEligibility } from 'src/module/xvi-fc/common/types/pmu-row-summary.type';
import type { PmuReviewPermissions } from 'src/module/xvi-fc/common/types/pmu-review-permissions.type';

/** Lean form projection read/written by the PMU review domain — mirrors the State module's own
 *  lean shapes but scoped to only the fields PMU review needs. */
export interface FcUnspentPmuFormLean {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  currentFormStatus: number;
  isFcUnspent: boolean | null;
  fcDeclaration: unknown;
  checkboxConfirmation: boolean;
  auditRevision: number;
}

/** Lean row projection used throughout the PMU review domain (list, transitions, snapshots). */
export interface FcUnspentPmuRowLean {
  _id: Types.ObjectId;
  form: Types.ObjectId;
  rowNumber: number;
  ulbId: Types.ObjectId;
  censusCode: string;
  sbCode: string;
  ulbName: string;
  allocationAmount: number;
  unspentAmount: number;
  previousFcUnspentBalance: number;
  allocationPerc: number;
  eligibility: boolean;
  rowStatus: RowReviewStatus | null;
  /** May be `undefined` on rows inserted via the State module's bulkWrite upsert (schema defaults
   *  aren't applied on raw bulkWrite inserts) — always read as `rejectionRemark ?? null`. */
  rejectionRemark?: string | null;
}

export interface FcUnspentPmuRowTransitionRequest {
  row: FcUnspentPmuRowLean;
  newStatus: RowReviewStatus;
  rejectionRemark: string | null;
}

export type FcUnspentPmuRowSummary = PmuRowSummaryWithEligibility;

export interface FcUnspentPmuReviewPermissions extends PmuReviewPermissions {
  canReviewRows: boolean;
}

export interface FcUnspentPmuReviewData {
  formId: string;
  stateId: string;
  stateName: string;
  yearId: string;
  designYear: string;
  applicableFc: ApplicableFc;
  isFcUnspent: boolean | null;
  fcDeclaration: unknown;
  checkboxConfirmation: boolean;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  /** Set on PMU reject, never cleared until the next transition overwrites it. */
  pmuRemarks: string | null;
  threshold: number;
  questions: HydratedFieldConfig[];
  rowSummary: FcUnspentPmuRowSummary;
  permissions: FcUnspentPmuReviewPermissions;
  actors: XvifcFormActor[];
}

export interface FcUnspentPmuRowPermissions {
  canApprove: boolean;
  canReject: boolean;
}

export interface FcUnspentPmuRow {
  _id: string;
  rowNumber: number;
  ulbId: string;
  censusCode: string | null;
  sbCode: string | null;
  ulbName: string;
  allocationAmount: number;
  unspentAmount: number;
  previousFcUnspentBalance: number;
  allocationPerc: number;
  eligibility: boolean;
  rowStatus: RowReviewStatus | null;
  rejectionRemark: string | null;
  permissions: FcUnspentPmuRowPermissions;
}

export interface FcUnspentPmuRowsData {
  rows: FcUnspentPmuRow[];
}

export interface FcUnspentPmuSubmitData {
  currentFormStatus: number;
  currentFormStatusLabel: string;
}

export interface FcUnspentPmuBulkActionData {
  updatedRowCount: number;
  rowSummary: FcUnspentPmuRowSummary;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  parentAcknowledged: boolean;
}
