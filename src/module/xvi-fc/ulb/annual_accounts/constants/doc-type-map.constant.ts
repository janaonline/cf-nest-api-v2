/**
 * Maps frontend docId values to the exact doc_type strings the Python OCR API expects.
 * NOTE: 'receipts-and-payments-statement' uses RECEIPTS_AND_PAYMENTS — confirm exact Python value before Phase 3.
 */
export const DOC_TYPE_MAP: Record<string, string> = {
  'balance-sheet': 'BALANCE_SHEET',
  'balance-sheet-schedules': 'BALANCE_SHEET_SCHEDULE',
  'income-expenditure': 'INCOME_EXPENDITURE',
  'income-statement-schedules': 'INCOME_EXPENDITURE_SCHEDULE',
  'cash-flow': 'CASH_FLOW',
  'auditors-report': 'AUDITOR_REPORT',
  'receipts-and-payments-statement': 'RECEIPTS_AND_PAYMENTS', // TODO: confirm Python doc_type value
};
