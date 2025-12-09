export interface DigitizationJobData {
  annualAccountsId: string;
  ulb: string;
  year: string;
  auditType: string;
  docType: string;
  fileUrl: string; // S3/HTTP URL, or internal path
  sourceType: 'ULB' | 'AFS';
}

export interface DigitizationJobResult {
  jobId: string;
}
