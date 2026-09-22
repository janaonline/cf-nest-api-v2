import type { XviFcDurDocId } from 'src/schemas/xvi-fc/dur.schema';

export interface DurValidationJobData {
  uploadId: string;
  durId: string;
  ulbId: string;
  docId: XviFcDurDocId;
  s3Key: string;
  financialYear: string;
}
