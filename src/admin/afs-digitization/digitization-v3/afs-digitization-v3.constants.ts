import { DocumentType } from '../dto/digitization-report-query.dto';

/** Nest doc type key -> FastAPI v3 `doc_type` form value (DocumentTypeEnum). */
export const NEST_TO_FASTAPI_DOC_TYPE: Record<string, string> = {
  bal_sheet: 'BALANCE_SHEET',
  bal_sheet_schedules: 'BALANCE_SHEET_SCHEDULE',
  inc_exp: 'INCOME_EXPENDITURE',
  inc_exp_schedules: 'INCOME_EXPENDITURE_SCHEDULE',
  cash_flow: 'CASH_FLOW',
};

/** FastAPI v3 AfsDocumentType -> Nest doc type key. */
export const FASTAPI_TO_NEST_DOC_TYPE: Record<string, string> = {
  BALANCE_SHEET: 'bal_sheet',
  BALANCE_SHEET_SCHEDULE: 'bal_sheet_schedules',
  INCOME_EXPENDITURE: 'inc_exp',
  INCOME_EXPENDITURE_SCHEDULE: 'inc_exp_schedules',
  CASH_FLOW: 'cash_flow',
  AUDITOR_REPORT: 'auditor_report',
  UNKNOWN: 'unknown',
};

export const UNKNOWN_DOC_TYPE = 'unknown';

/** Auditor reports live in a different collection and are a single document by nature. */
export const V3_DOC_TYPES: string[] = Object.values(DocumentType).filter(
  (t) => t !== DocumentType.AUDITORS_REPORT,
);

/** Upper bound for a single enqueue-by-filter call. */
export const MAX_ENQUEUE_BATCH = 10000;

export interface AfsDigitizationV3JobData {
  annualAccountsId?: string;
  ulb: string;
  year: string;
  auditType: string;
  docType: string;
  pdfUrl: string;
  ulbName?: string;
}
