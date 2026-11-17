import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

@Schema({ collection: 'afs_metrics', timestamps: true })
export class AfsMetric {
  @Prop({ type: String, default: 'all' })
  docType: string;

  @Prop({ type: Number, default: 0 })
  digitizedFiles: number;

  @Prop({ type: Number, default: 0 })
  digitizedPages: number;

  @Prop({ type: Number, default: 0 })
  queuedFiles: number;

  @Prop({ type: Number, default: 0 })
  queuedPages: number;

  @Prop({ type: Number, default: 0 })
  failedFiles: number;

  @Prop({ type: Number, default: 0 })
  failedPages: number;

  /** Digitization v3 only (docType 'v3'): files that have entered the v3 pipeline */
  @Prop({ type: Number, default: 0 })
  totalFiles: number;

  /** Digitization v3 only (docType 'v3') */
  @Prop({ type: Number, default: 0 })
  processingFiles: number;

  /** Digitization v3 only (docType 'v3'): how many digitized files have each score; refreshed by rebuild / backfill */
  @Prop({ type: Object })
  scoreSummary?: {
    digitized: number;
    withScoresObject: number;
    withTextract: number;
    withAccuracy: number;
    withArithmetic: number;
    withOverall: number;
    mismatches: number;
    /** Crosscheck confidence (accuracyScore) at or above / below 80 */
    confidenceHigh: number;
    confidenceLow: number;
    arithmeticPass: number;
    arithmeticFail: number;
    overallPass: number;
    overallPartial: number;
    overallFail: number;
    computedAt: Date;
  };

  /** Digitization v3 only (docType 'v3'): files run through the old flow vs v3; refreshed by rebuild / backfill */
  @Prop({ type: Object })
  runSummary?: {
    totalRun: number;
    oldDigitized: number;
    newDigitized: number;
    oldFailed: number;
    newFailed: number;
    computedAt: Date;
  };

  /** Digitization v3 uniqueness baseline (docType 'v3-uniqueness'): pages in the unique files (totalFiles = the unique files) */
  @Prop({ type: Number, default: 0 })
  totalPages: number;

  /** docType 'v3-uniqueness': `{ '2023-24': { files, pages } }` */
  @Prop({ type: Object })
  byYear?: Record<string, { files: number; pages: number }>;

  /** docType 'v3-uniqueness': `{ audited: { files, pages }, unAudited: { files, pages } }` */
  @Prop({ type: Object })
  byAuditType?: Record<string, { files: number; pages: number }>;

  /**
   * docType 'v3-uniqueness': one entry per year / docType / state / auditType that has a PDF. `files` and `pages`
   * are the unique ones; `duplicates` are the same-file slots left out. Sums of `files` / `pages` equal totalFiles / totalPages.
   */
  @Prop({ type: [Object] })
  breakdown?: {
    year: string;
    docType: string;
    state: string;
    auditType: string;
    files: number;
    pages: number;
    duplicates: number;
  }[];
}

// export type AfsMetricDocument = AfsMetric & Document;
export type AfsMetricDocument = HydratedDocument<AfsMetric>;
export const AfsMetricSchema = SchemaFactory.createForClass(AfsMetric);
AfsMetricSchema.index({ docType: 1 }, { unique: true });
