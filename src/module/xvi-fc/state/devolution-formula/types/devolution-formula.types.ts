import type { Types } from 'mongoose';
import type { HydratedFieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import type { DfInstallment, DfValidationStatus } from '../constants/devolution-formula.constants';

export interface DfFormPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

export interface DfFileRefData {
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType?: string;
  s3Key?: string;
}

export interface DfValidationSummary {
  excelRowCount: number;
  validRowCount: number;
  errorRowCount: number;
  missingUlbCount: number;
  totalMoHUAAllocation: number;
  totalAllocatedSum: number;
  allUlbsCovered: boolean;
  allocationBalanced: boolean;
  validationStatus: DfValidationStatus;
  activeDatasetVersion: number;
}

export interface DfGrantAllocationSummary {
  grantAllocationId: string;
  basic: number;
  performance: number;
  total: number;
}

export interface DfSupportingAction {
  key: string;
  label: string;
  enabled: boolean;
}

export interface DfFormGetResponseData {
  _id: string | null;
  formName: string;
  stateId: string;
  yearId: string;
  installment: DfInstallment;
  stateName: string;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  permissions: DfFormPermissions;
  actors: unknown[];
  validationSummary: DfValidationSummary;
  grantAllocationSummary: DfGrantAllocationSummary | null;
  questions: HydratedFieldConfig[];
  meta: { version: number };
}

export interface DfRowError {
  field: string;
  code: string;
  message: string;
  value?: unknown;
}

export interface DfRowValidationError {
  rowNumber: number;
  censusCode?: string;
  sbCode?: string;
  ulbName?: string;
  field: string;
  code: string;
  message: string;
  value?: unknown;
}

export interface DfValidateExcelResponseData {
  validationStatus: DfValidationStatus;
  summary: DfValidationSummary;
  errorExcelFile?: DfFileRefData;
  rowErrors: DfRowValidationError[];
}

export interface DfRevalidateExcelResponseData {
  validationSummary: DfValidationSummary;
  rowErrors: DfRowValidationError[];
}

export interface DfFormLeanDoc {
  _id: unknown;
  state?: unknown;
  year?: unknown;
  installment?: DfInstallment;
  createdBy?: unknown;
  updatedBy?: unknown;
  submittedBy?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  submittedAt?: Date | null;
  currentFormStatus?: number;
  validationStatus?: DfValidationStatus;
  activeDatasetVersion?: number;
  excelRowCount?: number;
  errorRowCount?: number;
  totalMoHUAAllocation?: number;
  totalAllocatedSum?: number;
  grantAllocationRef?: Types.ObjectId;
  excelFile?: DfFileRefData;
  errorExcelFile?: DfFileRefData;
  checkboxConfirmation?: boolean;
  mohuaRemarks?: string | null;
}

export interface DfDumpRow {
  rowNumber: number;
  stateName: string;
  yearLabel: string;
  installment: number;
  formStatus: string;
  validationStatus: string;
  censusCode: string;
  sbCode: string;
  ulbName: string;
  totalGrantAllocation: number | string;
  installment1Amount: number | string;
  installment2Amount: number | string;
  devolutionFormula: string;
  datasetVersion: number;
  createdAt: string;
  updatedAt: string;
}
