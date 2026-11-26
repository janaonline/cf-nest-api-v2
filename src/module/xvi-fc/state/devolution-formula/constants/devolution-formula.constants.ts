import type { RowHeader } from 'src/services/excel/excel.service';

export const DF_FORM_NAME = 'ULB-wise Allocation';
export const DF_FORM_TYPE = 'DEVOLUTION_FORMULA';
export const DF_FORM_ID = 24;

export const DF_INSTALLMENTS = [1, 2] as const;
export type DfInstallment = (typeof DF_INSTALLMENTS)[number];

// ─── Excel header ↔ camelCase key mapping ──────────────────────────────────

export const DF_EXCEL_HEADER_MAP: Record<string, string> = {
  'Census Code': 'censusCode',
  censusCode: 'censusCode',
  'ULB Name': 'ulbName',
  ulbName: 'ulbName',
  'Total Grant Allocation': 'totalGrantAllocation',
  'Total Grant Allocation (Rs.)': 'totalGrantAllocation',
  'Total Grant Allocation (Cr.)': 'totalGrantAllocation',
  totalGrantAllocation: 'totalGrantAllocation',
  'Installment 1 Amount': 'installment1Amount',
  'Installment 1 Amount (Rs.)': 'installment1Amount',
  'Installment 1 Amount (Cr.)': 'installment1Amount',
  installment1Amount: 'installment1Amount',
  'Installment 2 Amount': 'installment2Amount',
  'Installment 2 Amount (Rs.)': 'installment2Amount',
  'Installment 2 Amount (Cr.)': 'installment2Amount',
  installment2Amount: 'installment2Amount',
  'Allocation Formula': 'devolutionFormula',
  devolutionFormula: 'devolutionFormula',
};

// Instalment columns are optional on upload: their values are ignored (always Total / 2).
export const DF_REQUIRED_EXCEL_KEYS = ['ulbName', 'totalGrantAllocation', 'devolutionFormula'] as const;

// ─── Template / error Excel column definitions ──────────────────────────────

/** Instalments are Total / 2, so they can end in .50. */
export const DF_INSTALLMENT_NUM_FMT = '#,##0.00';

/** Header comment on the instalment columns; the portal's header tooltips use the same text. */
export const DF_INSTALLMENT_NOTE = 'Calculated automatically as half of the Total Allocation.';

// Instalment columns are read-only, greyed-out formula cells in the template (Total / 2); the State types only the Total.
export const DF_TEMPLATE_HEADERS: RowHeader[] = [
  { label: 'Census Code', key: 'censusCode', width: 15 },
  { label: 'ULB Name', key: 'ulbName', width: 35 },
  {
    label: 'Installment 1 Amount (Rs.)',
    key: 'installment1Amount',
    width: 27,
    numFmt: DF_INSTALLMENT_NUM_FMT,
    readOnly: true,
    note: DF_INSTALLMENT_NOTE,
  },
  {
    label: 'Installment 2 Amount (Rs.)',
    key: 'installment2Amount',
    width: 27,
    numFmt: DF_INSTALLMENT_NUM_FMT,
    readOnly: true,
    note: DF_INSTALLMENT_NOTE,
  },
  { label: 'Total Grant Allocation (Rs.)', key: 'totalGrantAllocation', width: 24 },
  { label: 'Allocation Formula', key: 'devolutionFormula', width: 30 },
];

/** Column the template's instalment formulas read from (single letter: the template has under 26 columns). */
export const DF_TEMPLATE_TOTAL_COLUMN_LETTER = String.fromCharCode(
  65 + DF_TEMPLATE_HEADERS.findIndex((h) => h.key === 'totalGrantAllocation'),
);

// The error sheet holds fixed instalment values, not formulas, so it is neither greyed out nor commented.
export const DF_ERROR_EXCEL_HEADERS: RowHeader[] = [
  ...DF_TEMPLATE_HEADERS.map(({ readOnly: _readOnly, note: _note, ...header }) => header),
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
  { label: 'ULB Name', key: 'ulbName', width: 35 },
  { label: 'Total Grant Allocation (Rs.)', key: 'totalGrantAllocation', width: 24 },
  { label: 'Installment 1 Amount (Rs.)', key: 'installment1Amount', width: 22, numFmt: DF_INSTALLMENT_NUM_FMT },
  { label: 'Installment 2 Amount (Rs.)', key: 'installment2Amount', width: 22, numFmt: DF_INSTALLMENT_NUM_FMT },
  { label: 'Allocation Formula', key: 'devolutionFormula', width: 30 },
  { label: 'Dataset Version', key: 'datasetVersion', width: 18 },
  { label: 'Submitted By', key: 'submittedBy', width: 25 },
  { label: 'Submitted At', key: 'submittedAt', width: 24 },
  { label: 'Created By', key: 'createdBy', width: 25 },
  { label: 'Updated By', key: 'updatedBy', width: 25 },
  { label: 'Created At', key: 'createdAt', width: 24 },
  { label: 'Updated At', key: 'updatedAt', width: 24 },
];

// ─── Folder paths (S3 sub-paths) ────────────────────────────────────────────

export const DF_FOLDER_PATH_EXCELS = 'devolution-formula/excels';
export const DF_FOLDER_PATH_ERROR_SHEETS = 'devolution-formula/error-sheets';

// ─── Supporting action keys ──────────────────────────────────────────────────

export const DF_ACTION_DOWNLOAD_TEMPLATE = 'download-template';
export const DF_ACTION_VIEW_UPLOADED_DATA = 'view-uploaded-data';
export const DF_ACTION_DOWNLOAD_ERROR_SHEET = 'download-error-sheet';
export const DF_ACTION_REVALIDATE_EXCEL = 'revalidate-excel';
export const DF_ACTION_REGISTER_ULB = 'register-ulb';

export function buildDfRegisterUlbUrl(yearId: string): string {
  return `/xvifc/${yearId}/register-ulb`;
}

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
