import type { HydratedFieldConfig } from '../../common/types/field-config.type';
import type { EulbValidationStatus } from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';

export interface EulbFormPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

export interface EulbFormActor {
  action: 'Created by' | 'Updated by' | 'Submitted by';
  by: string | null;
  date: string | null;
}

export interface EulbValidationSummary {
  dbUlbCount: number;
  maxAllowedExcelRows: number;
  excelRowCount: number;
  matchedDbUlbCount: number;
  missingDbUlbCount: number;
  extraExcelRowCount: number;
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
  permissions: EulbFormPermissions;
  actors: EulbFormActor[];
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

/** File reference shape used for electedBodyExcelFile and errorExcelFile. */
export interface EulbFileRefData {
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType?: string;
  s3Key?: string;
}

/** Shape of the `data` field returned by POST validate-excel. */
export interface EulbValidateExcelResponseData {
  validationStatus: EulbValidationStatus;
  summary: EulbValidationSummary;
  errorExcelFile?: EulbFileRefData;
  errors: EulbRowValidationError[];
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
  electedBodyExcelFile?: {
    fileName: string;
    fileUrl: string;
    fileSize: number | null;
    mimeType?: string;
    s3Key?: string;
  };
  checkboxConfirmation?: boolean;
  dbUlbCount?: number;
  maxAllowedExcelRows?: number;
  excelRowCount?: number;
  matchedDbUlbCount?: number;
  missingDbUlbCount?: number;
  extraExcelRowCount?: number;
  errorRowCount?: number;
  validationStatus?: EulbValidationStatus;
  activeDatasetVersion?: number;
}
