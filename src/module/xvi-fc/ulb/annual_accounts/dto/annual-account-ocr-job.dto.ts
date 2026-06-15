export interface AnnualAccountOcrJobData {
  uploadId: string;
  annualAccountId: string;
  ulbId: string;
  section: string;
  requirementId: string;
  docId: string;
  s3Key: string;
  expectedDocType: string;
  financialYear: string;
}
