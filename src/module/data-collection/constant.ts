/** Data Collection Scopes */
export const DATA_COLLECTION_SCOPES = {
  TEMPLATE_READ: 'data_collection:template:read',
  ULBS_READ: 'data_collection:ulbs:read',
  YEARS_READ: 'data_collection:years:read',
  FINANCIAL_DATA_SUBMIT: 'data_collection:financial_data:submit',
  FINANCIAL_DATA_MODIFY: 'data_collection:financial_data:modify',
} as const;

// Data collection audit actions
/** Audit event action identifiers for data collection submit/modify operations. */
export const DATA_COLLECTION_AUDIT_ACTION = {
  SUBMITTED: 'DATA_COLLECTION_SUBMITTED',
  MODIFIED: 'DATA_COLLECTION_MODIFIED',
  VALIDATION_FAILED: 'DATA_COLLECTION_VALIDATION_FAILED',
  SUBMIT_DUPLICATE: 'DATA_COLLECTION_SUBMIT_DUPLICATE',
  NOT_FOUND_FOR_MODIFY: 'DATA_COLLECTION_NOT_FOUND_FOR_MODIFY',
  REVERSED: 'DATA_COLLECTION_REVERSED',
} as const;

export type DataCollectionAuditAction =
  (typeof DATA_COLLECTION_AUDIT_ACTION)[keyof typeof DATA_COLLECTION_AUDIT_ACTION];

export const DATA_COLLECTION_AUDIT_ACTION_VALUES = Object.values(DATA_COLLECTION_AUDIT_ACTION);

/** Machine-readable failure reasons stored in audit logs for non-success events. */
export const DATA_COLLECTION_FAILURE_REASON = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  DUPLICATE_SUBMISSION: 'DUPLICATE_SUBMISSION',
  DATA_COLLECTION_NOT_FOUND: 'DATA_COLLECTION_NOT_FOUND',
} as const;

export type DataCollectionFailureReason =
  (typeof DATA_COLLECTION_FAILURE_REASON)[keyof typeof DATA_COLLECTION_FAILURE_REASON];

export const DATA_COLLECTION_FAILURE_REASON_VALUES = Object.values(DATA_COLLECTION_FAILURE_REASON);
