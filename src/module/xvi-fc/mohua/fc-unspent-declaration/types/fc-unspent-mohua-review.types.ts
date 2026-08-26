import type { Types } from 'mongoose';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import type { XvifcFormActor } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import type { ApplicableFc } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';

/** Lean form projection read/written by the MoHUA review domain — mirrors the State module's
 *  own lean shapes but scoped to only the fields MoHUA review needs. */
export interface FcUnspentMohuaFormLean {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  currentFormStatus: number;
  isFcUnspent: boolean | null;
  fcDeclaration: unknown;
  checkboxConfirmation: boolean;
  auditRevision: number;
}

/** Lean row projection used throughout the MoHUA review domain (list, transitions, snapshots). */
export interface FcUnspentMohuaRowLean {
  _id: Types.ObjectId;
  form: Types.ObjectId;
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
  /** May be `undefined` on rows inserted via the State module's bulkWrite upsert (schema defaults
   *  aren't applied on raw bulkWrite inserts) — always read as `rejectionRemark ?? null`. */
  rejectionRemark?: string | null;
}

export interface FcUnspentRowTransitionRequest {
  row: FcUnspentMohuaRowLean;
  newStatus: RowReviewStatus;
  rejectionRemark: string | null;
}

export interface FcUnspentMohuaRowSummary {
  total: number;
  active: number;
  updatePending: number;
  rejected: number;
  needsUpdate: number;
  eligible: number;
  ineligible: number;
}

export interface FcUnspentMohuaReviewPermissions {
  canView: boolean;
  canApproveForm: boolean;
  canRejectForm: boolean;
  canReviewRows: boolean;
}

export interface FcUnspentMohuaReviewData {
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
  threshold: number;
  rowSummary: FcUnspentMohuaRowSummary;
  permissions: FcUnspentMohuaReviewPermissions;
  actors: XvifcFormActor[];
}

export interface FcUnspentMohuaRowPermissions {
  canApprove: boolean;
  canReject: boolean;
}

export interface FcUnspentMohuaRow {
  _id: string;
  rowNumber: number;
  ulbId: string;
  censusCode: string | null;
  sbCode: string | null;
  ulbName: string;
  allocationAmount: number;
  unspentAmount: number;
  allocationPerc: number;
  eligibility: boolean;
  rowStatus: RowReviewStatus | null;
  rejectionRemark: string | null;
  permissions: FcUnspentMohuaRowPermissions;
}

export interface FcUnspentMohuaRowsData {
  rows: FcUnspentMohuaRow[];
}

export interface FcUnspentMohuaSubmitData {
  currentFormStatus: number;
  currentFormStatusLabel: string;
}

export interface FcUnspentMohuaBulkActionData {
  updatedRowCount: number;
  rowSummary: FcUnspentMohuaRowSummary;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  parentAcknowledged: boolean;
}
