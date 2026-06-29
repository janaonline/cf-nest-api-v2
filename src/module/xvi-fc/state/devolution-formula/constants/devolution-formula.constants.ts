import type { RowHeader } from 'src/services/excel/excel.service';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';

export const DF_FORM_NAME = 'Devolution Formula';
export const DF_FORM_TYPE = 'DEVOLUTION_FORMULA';
export const DF_ROUTE_BASE = 'xvi-fc/state/devolution-formula';

export const DF_INSTALLMENTS = [1, 2] as const;
export type DfInstallment = (typeof DF_INSTALLMENTS)[number];

// ─── Excel header ↔ camelCase key mapping ──────────────────────────────────

export const DF_EXCEL_HEADER_MAP: Record<string, string> = {
  'Census Code': 'censusCode',
  censusCode: 'censusCode',
  'SB Code': 'sbCode',
  sbCode: 'sbCode',
  'ULB Name': 'ulbName',
  ulbName: 'ulbName',
  'Total Grant Allocation': 'totalGrantAllocation',
  totalGrantAllocation: 'totalGrantAllocation',
  'Installment 1 Amount': 'installment1Amount',
  installment1Amount: 'installment1Amount',
  'Installment 2 Amount': 'installment2Amount',
  installment2Amount: 'installment2Amount',
  'Devolution Formula': 'devolutionFormula',
  devolutionFormula: 'devolutionFormula',
};

export const DF_REQUIRED_EXCEL_KEYS = [
  'ulbName',
  'totalGrantAllocation',
  'installment1Amount',
  'installment2Amount',
  'devolutionFormula',
] as const;

// ─── Template / error Excel column definitions ──────────────────────────────

export const DF_TEMPLATE_HEADERS: RowHeader[] = [
  { label: 'Census Code', key: 'censusCode', width: 15 },
  { label: 'SB Code', key: 'sbCode', width: 15 },
  { label: 'ULB Name', key: 'ulbName', width: 35 },
  { label: 'Total Grant Allocation', key: 'totalGrantAllocation', width: 24 },
  { label: 'Installment 1 Amount', key: 'installment1Amount', width: 22 },
  { label: 'Installment 2 Amount', key: 'installment2Amount', width: 22 },
  { label: 'Devolution Formula', key: 'devolutionFormula', width: 30 },
];

export const DF_ERROR_EXCEL_HEADERS: RowHeader[] = [
  ...DF_TEMPLATE_HEADERS,
  { label: 'Errors', key: 'errors', width: 70 },
];

export const DF_DUMP_HEADERS: RowHeader[] = [
  { label: 'Row Number', key: 'rowNumber', width: 12 },
  { label: 'State', key: 'stateName', width: 28 },
  { label: 'Year', key: 'yearLabel', width: 12 },
  { label: 'Installment', key: 'installment', width: 14 },
  { label: 'Form Status', key: 'formStatus', width: 32 },
  { label: 'Validation Status', key: 'validationStatus', width: 20 },
  { label: 'Census Code', key: 'censusCode', width: 15 },
  { label: 'SB Code', key: 'sbCode', width: 15 },
  { label: 'ULB Name', key: 'ulbName', width: 35 },
  { label: 'Total Grant Allocation', key: 'totalGrantAllocation', width: 24 },
  { label: 'Installment 1 Amount', key: 'installment1Amount', width: 22 },
  { label: 'Installment 2 Amount', key: 'installment2Amount', width: 22 },
  { label: 'Devolution Formula', key: 'devolutionFormula', width: 30 },
  { label: 'Dataset Version', key: 'datasetVersion', width: 18 },
  { label: 'Created At', key: 'createdAt', width: 24 },
  { label: 'Updated At', key: 'updatedAt', width: 24 },
];

// ─── Folder paths (S3 sub-paths) ────────────────────────────────────────────

export const DF_FOLDER_PATH_EXCELS = 'devolution-formula/excels';
export const DF_FOLDER_PATH_ERROR_SHEETS = 'devolution-formula/error-sheets';

// ─── File upload constraints ─────────────────────────────────────────────────

export const DF_MAX_FILE_SIZE_MB = 20;
export const DF_MAX_FILE_SIZE_BYTES = DF_MAX_FILE_SIZE_MB * 1024 * 1024;
export const DF_ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
] as const;
export const DF_ALLOWED_FILE_EXTENSIONS = ['.xlsx', '.xls'] as const;

// ─── Supporting action keys ──────────────────────────────────────────────────

export const DF_ACTION_DOWNLOAD_TEMPLATE = 'download-template';
export const DF_ACTION_VIEW_UPLOADED_DATA = 'view-uploaded-data';
export const DF_ACTION_DOWNLOAD_ERROR_SHEET = 'download-error-sheet';
export const DF_ACTION_REVALIDATE_EXCEL = 'revalidate-excel';

// ─── Pagination defaults ─────────────────────────────────────────────────────

export const DF_PAGINATION_DEFAULT_PAGE = 1;
export const DF_PAGINATION_DEFAULT_LIMIT = 20;
export const DF_PAGINATION_MAX_LIMIT = 200;

// ─── Validation status values ────────────────────────────────────────────────

export const DF_VALIDATION_STATUS = {
  NOT_VALIDATED: 'NOT_VALIDATED',
  VALID: 'VALID',
  INVALID: 'INVALID',
} as const;

export type DfValidationStatus = (typeof DF_VALIDATION_STATUS)[keyof typeof DF_VALIDATION_STATUS];

// ─── Row-level validation status ────────────────────────────────────────────

export const DF_ROW_VALIDATION_STATUS = {
  VALID: 'VALID',
  INVALID: 'INVALID',
} as const;

export type DfRowValidationStatus = (typeof DF_ROW_VALIDATION_STATUS)[keyof typeof DF_ROW_VALIDATION_STATUS];

// ─── Constant-backed form field definitions ───────────────────────────────────

export const DF_FORM_QUESTIONS: FieldConfig[] = [
  {
    formFieldType: 'number',
    label: 'How many ULBs are there in the state as of March 31, 2026?',
    key: 'ulbCount',
    value: 0,
    placeholder: '',
    validations: [
      {
        name: 'required',
        validator: null,
        message: 'This field is required.',
      },
      {
        name: 'min',
        validator: 10,
        message: 'ULB count cannot be less than 10.',
      },
      {
        name: 'max',
        validator: 1000,
        message: 'ULB count cannot exceed 1000.',
      },
    ],
    layout: {
      variant: 'inline',
      labelWidth: 'lg',
    },
  },
  {
    formFieldType: 'file',
    key: 'excelFile',
    label: 'Upload Devolution Formula Excel',
    allowedFileTypes: ['xlsx', 'xls'],
    maxFileSize: DF_MAX_FILE_SIZE_MB,
    folderPathKey: DF_FOLDER_PATH_EXCELS,
    validations: [{ name: 'required', validator: null, message: 'Excel file is required.' }],
    appearance: {
      color: 'success',
      variant: 'soft',
    },
    value: {
      fileName: '',
      fileUrl: '',
      fileSize: null,
      mimeType: '',
    },
  },
  {
    formFieldType: 'checkbox',
    key: 'checkboxConfirmation',
    label:
      'I understand that this submission may contain information entered or modified by other users. I have reviewed the final submission and confirm that the information being submitted is complete and accurate to the best of my knowledge.',
    value: false,
    validations: [
      {
        name: 'requiredTrue',
        validator: null,
        message: 'Please confirm before submitting.',
      },
    ],
  },
];
