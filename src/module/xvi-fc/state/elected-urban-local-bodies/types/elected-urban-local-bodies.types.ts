import type { Types } from 'mongoose';
import type { FileInfo } from 'src/schemas/common/file.schema';
import type { HydratedFileInfoResponse } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import type { FieldConfig, HydratedFieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import type { EulbValidationStatus } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import type {
  EulbRowSource,
  EulbRowValidationStatus,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import type { XvifcFormActor } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';

export interface EulbFormPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

export interface EulbValidationSummary {
  dbUlbCount: number;
  maxAllowedExcelRows: number;
  excelRowCount: number;
  matchedDbUlbCount: number;
  missingDbUlbCount: number;
  extraExcelRowCount: number;
  duplicateUlbCount: number;
  errorRowCount: number;
  validationStatus: EulbValidationStatus;
  activeDatasetVersion: number;
}

export interface EulbFormGetResponseData {
  _id: string | null;
  formName: string;
  stateId: string;
  yearId: string;
  stateName: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  questions: HydratedFieldConfig[];
  rowEditFields: FieldConfig[];
  permissions: EulbFormPermissions;
  actors: XvifcFormActor[];
  validationSummary: EulbValidationSummary;
  instructions: unknown[];
  meta: { version: number };
}

/** One row-level error entry surfaced in the validate-excel response and the error Excel column. */
export interface EulbRowValidationError {
  rowNumber: number;
  censusCode?: string;
  ulbName?: string;
  field: string;
  code: string;
  message: string;
  value?: unknown;
}

/** Shape of the `data` field returned by POST validate-excel. */
export interface EulbValidateExcelResponseData {
  validationStatus: EulbValidationStatus;
  summary: EulbValidationSummary;
  errorExcelFile?: HydratedFileInfoResponse;
  errors: EulbRowValidationError[];
}

/** Shape of the `data` field returned by POST revalidate-excel. */
export interface EulbRevalidateExcelResponseData {
  validationSummary: EulbValidationSummary;
  errors: EulbRowValidationError[];
}

export interface EulbDumpFormRecord {
  _id: Types.ObjectId;
  activeDatasetVersion?: number;
  submittedBy?: EulbDumpUser;
  submittedAt?: Date;
}

export interface EulbDumpUser {
  _id: Types.ObjectId;
  name: string;
}

export interface EulbDumpRowRecord {
  rowNumber: number;
  censusCode?: string | null;
  ulbName: string;
  electedBodyStatus?: string | null;
  dateOfConstitution?: Date | string | null;
  dateOfExpiry?: Date | string | null;
  remarks?: string | null;
  validationStatus: EulbRowValidationStatus;
  lastUpdatedSource: EulbRowSource;
  datasetVersion: number;
  createdBy?: EulbDumpUser;
  updatedBy?: EulbDumpUser;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EulbDumpRow {
  rowNumber: number;
  censusCode: string;
  ulbName: string;
  electedBodyStatus: string;
  dateOfConstitution: string;
  dateOfExpiry: string;
  remarks: string;
  validationStatus: string;
  latestDataSource: string;
  datasetVersion: number;
  submittedBy: string;
  submittedAt: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EulbStatusSummary {
  totalUlbCount: number;
  constitutedCount: number;
  notConstitutedCount: number;
  exemptCount: number;
}

export interface EulbPostSubmissionUpdatePermissions {
  canView: boolean;
  canSubmitUpdate: boolean;
}

export interface EulbPostSubmissionUpdateSummary {
  eligibleRowCount: number;
}

export interface EulbPostSubmissionUpdateMetaData {
  stateId: string;
  formStatus: number;
  canUpdate: boolean;
  permissions: EulbPostSubmissionUpdatePermissions;
  summary: EulbPostSubmissionUpdateSummary;
  rowEditFields: FieldConfig[];
  questions: FieldConfig[];
}

export interface EulbPostSubmissionUpdateRow {
  _id: string;
  rowNumber: number;
  censusCode: string | null;
  ulbName: string;
  electedBodyStatus: string;
  dateOfConstitution: string | null;
  dateOfExpiry: string | null;
  remarks: string | null;
  validationStatus: string;
  errors: Array<{
    field?: string;
    code?: string;
    message: string;
    value?: unknown;
  }>;
}

export interface EulbPostSubmissionUpdateRowsData {
  rows: EulbPostSubmissionUpdateRow[];
  total: number;
  page: number;
  limit: number;
  eligibleRule: {
    allowedFormStatuses: number[];
    today: string;
  };
  statusSummary: EulbStatusSummary;
}

export interface EulbPostSubmissionUpdateValidateRow {
  rowId: string;
  rowNumber: number;
  censusCode: string | null;
  ulbName: string;
  electedBodyStatus: string;
  dateOfConstitution: string | null;
  dateOfExpiry: string | null;
  remarks: string;
  validationStatus: 'VALID' | 'INVALID';
  errors: Array<{
    field?: string;
    code?: string;
    message: string;
    value?: unknown;
  }>;
}

export interface EulbPostSubmissionUpdateValidateData {
  validationStatus: 'VALID' | 'INVALID';
  rows: EulbPostSubmissionUpdateValidateRow[];
  errorRowCount: number;
  validRowCount: number;
  totalRowCount: number;
}

export interface EulbPostSubmissionSubmitRowError {
  rowId: string;
  rowNumber: number;
  censusCode: string | null;
  ulbName: string;
  errors: Array<{ field?: string; code?: string; message: string; value?: unknown }>;
}

export interface EulbPostSubmissionUpdateSubmitData {
  batchId: string;
  updatedRowCount: number;
  document: HydratedFileInfoResponse;
  validationSummary: EulbValidationSummary;
}

/** Lean doc shape returned by Mongoose populate for getForm queries */
export interface EulbFormLeanDoc {
  _id: unknown;
  state?: unknown;
  createdBy?: unknown;
  updatedBy?: unknown;
  submittedBy?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  submittedAt?: Date;
  currentFormStatus?: number;
  ulbCount?: number;
  electedBodyExcelFile?: FileInfo;
  errorExcelFile?: FileInfo;
  checkboxConfirmation?: boolean;
  dbUlbCount?: number;
  maxAllowedExcelRows?: number;
  excelRowCount?: number;
  matchedDbUlbCount?: number;
  missingDbUlbCount?: number;
  extraExcelRowCount?: number;
  duplicateUlbCount?: number;
  errorRowCount?: number;
  validationStatus?: EulbValidationStatus;
  activeDatasetVersion?: number;
}
