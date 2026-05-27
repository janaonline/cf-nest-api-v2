import type { Types } from 'mongoose';

export type DataCollectionValidationStatus = 'VALID' | 'WARNING';

type ValidationErrorSummaryEntry = {
  lineItemCode: string;
  message: string;
  severity: string;
  expected?: number | null;
  received?: number | null;
};

export type DataCollectionAuditBaseData = {
  dataCollectionId?: Types.ObjectId;
  apiClientId?: Types.ObjectId;
  adminUserId?: Types.ObjectId;
  stateId: Types.ObjectId;
  ulbId: Types.ObjectId;
  yearId: Types.ObjectId;
  templateVersion: string;
  validationStatus?: DataCollectionValidationStatus;
  lineItemCount?: number;
  changedLineItemCodes?: string[];
  errorCount?: number;
  validationSummary?: { errors: ValidationErrorSummaryEntry[] };
  reason?: string;
  ip?: string;
  userAgent?: string;
};

export type LogDataCollectionSubmittedData = DataCollectionAuditBaseData & {
  apiClientId: Types.ObjectId;
  dataCollectionId: Types.ObjectId;
  validationStatus: DataCollectionValidationStatus;
  lineItemCount: number;
};

export type LogDataCollectionModifiedData = DataCollectionAuditBaseData & {
  apiClientId: Types.ObjectId;
  dataCollectionId: Types.ObjectId;
  validationStatus: DataCollectionValidationStatus;
  lineItemCount: number;
  changedLineItemCodes: string[];
};

export type LogDataCollectionValidationFailedData = DataCollectionAuditBaseData & {
  apiClientId: Types.ObjectId;
  lineItemCount: number;
  errorCount: number;
  validationSummary: { errors: ValidationErrorSummaryEntry[] };
};

export type LogDataCollectionDuplicateSubmitData = DataCollectionAuditBaseData & {
  apiClientId: Types.ObjectId;
  lineItemCount: number;
};

export type LogDataCollectionModifyNotFoundData = DataCollectionAuditBaseData & {
  apiClientId: Types.ObjectId;
  lineItemCount: number;
};

export type LogDataCollectionReversedData = DataCollectionAuditBaseData & {
  adminUserId: Types.ObjectId;
  dataCollectionId: Types.ObjectId;
  reason: string;
};
