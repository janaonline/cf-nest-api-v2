import type { Types } from 'mongoose';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import type { XvifcFormActor } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import type { HydratedFieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import type { EulbValidationStatus } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import type { PmuRowSummaryCore } from 'src/module/xvi-fc/common/types/pmu-row-summary.type';
import type { PmuReviewPermissions } from 'src/module/xvi-fc/common/types/pmu-review-permissions.type';

/** Lean form projection read/written by the PMU review domain — scoped to only the fields PMU
 *  review needs, mirroring FC Unspent's own `FcUnspentPmuFormLean`. */
export interface EulbPmuFormLean {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  currentFormStatus: number;
  activeDatasetVersion: number;
}

/** Lean row projection used throughout the PMU review domain (list, transitions, snapshots). */
export interface EulbPmuRowLean {
  _id: Types.ObjectId;
  form: Types.ObjectId;
  datasetVersion: number;
  rowNumber: number;
  ulbId: Types.ObjectId | null;
  censusCode: string | null;
  ulbName: string;
  electedBodyStatus: string | null;
  dateOfConstitution: Date | string | null;
  dateOfExpiry: Date | string | null;
  remarks: string | null;
  rowStatus: RowReviewStatus | null;
  rejectionRemark?: string | null;
}

export interface EulbPmuRowTransitionRequest {
  row: EulbPmuRowLean;
  newStatus: RowReviewStatus;
  rejectionRemark: string | null;
}

export type EulbPmuRowSummary = PmuRowSummaryCore;

export interface EulbPmuReviewPermissions extends PmuReviewPermissions {
  canReviewRows: boolean;
}

export interface EulbPmuReviewData {
  formId: string;
  stateId: string;
  stateName: string;
  yearId: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  /** Set on PMU reject, never cleared until the next transition overwrites it. */
  pmuRemarks: string | null;
  questions: HydratedFieldConfig[];
  rowSummary: EulbPmuRowSummary;
  /** Excel upload's validation status — needed by the frontend to bridge the synthetic
   *  `electedBodyExcelValidationStatus` control that `signedElectedbodyFile`'s `visibleWhen`
   *  condition gates on (same mechanism the State's own GET response/page already uses). */
  validationStatus: EulbValidationStatus;
  permissions: EulbPmuReviewPermissions;
  actors: XvifcFormActor[];
}

export interface EulbPmuRowPermissions {
  canApprove: boolean;
  canReject: boolean;
}

export interface EulbPmuRow {
  _id: string;
  rowNumber: number;
  ulbId: string | null;
  censusCode: string | null;
  ulbName: string;
  electedBodyStatus: string | null;
  dateOfConstitution: Date | string | null;
  dateOfExpiry: Date | string | null;
  remarks: string | null;
  rowStatus: RowReviewStatus | null;
  rejectionRemark: string | null;
  permissions: EulbPmuRowPermissions;
}

export interface EulbPmuRowsData {
  rows: EulbPmuRow[];
}

export interface EulbPmuSubmitData {
  currentFormStatus: number;
  currentFormStatusLabel: string;
}

export interface EulbPmuBulkActionData {
  updatedRowCount: number;
  rowSummary: EulbPmuRowSummary;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  parentAcknowledged: boolean;
}
