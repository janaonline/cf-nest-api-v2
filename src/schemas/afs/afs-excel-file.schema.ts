// afs-excel-file.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { Queue, QueueSchema } from '../queue.schema';
import { DigitizationStatuses, UploadedBy, AuditType } from './enums';

export type AfsExcelFileDocument = HydratedDocument<AfsExcelFile>;

@Schema({ _id: false })
export class AfsDigitizationV3Segment {
  @Prop({ type: String })
  docType: string; // nest doc type key, e.g. "bal_sheet"; "unknown" when FastAPI could not identify it

  @Prop({ type: Number })
  startPage: number;

  @Prop({ type: Number })
  endPage: number;

  @Prop({ type: String })
  title?: string;

  @Prop({ type: Boolean, default: false })
  isDuplicate: boolean;
}

const AfsDigitizationV3SegmentSchema = SchemaFactory.createForClass(AfsDigitizationV3Segment);

/** Scores FastAPI reports for a digitization job. Each is absent when that step did not run. */
@Schema({ _id: false })
export class AfsDigitizationV3Scores {
  /** True when the uploaded doc type (record docType) is not among detectedDocTypes */
  @Prop({ type: Boolean })
  isMismatch?: boolean;

  /** OCR confidence, 0-100 (FastAPI `confidence_score`); absent when the engine gives none */
  @Prop({ type: Number })
  ocrConfidenceScore?: number;

  /** Gemini cross-check accuracy vs the source PDF, 0-100 (FastAPI `accuracy_score`) */
  @Prop({ type: Number })
  accuracyScore?: number;

  /** PASS / FAIL / NOT_APPLICABLE (FastAPI `arithmetic_assessment`) */
  @Prop({ type: String })
  arithmeticAssessment?: string;

  /** PASS / PARTIAL / FAIL / UNVERIFIED (FastAPI `overall_assessment`) */
  @Prop({ type: String })
  overallAssessment?: string;
}

const AfsDigitizationV3ScoresSchema = SchemaFactory.createForClass(AfsDigitizationV3Scores);



// @Schema({ _id: false })
// export class AfsExcelFileQueue {
//   @Prop({ type: String })
//   jobId: string;

//   @Prop({ type: String, enum: Object.values(QueueStatus), default: QueueStatus.WAITING })
//   status: string;

//   @Prop({ type: Number, default: 0 }) // 0-100
//   progress: number;

//   @Prop({ type: String, required: false })
//   failedReason?: string;

//   @Prop({ type: Date, default: Date.now })
//   createdAt: Date;

//   @Prop({ type: Number, default: 0 })
//   attemptsMade: number;

//   @Prop({ type: Date, required: false })
//   processedOn?: Date;

//   @Prop({ type: Date, required: false })
//   finishedOn?: Date;
// }

// export const AfsExcelFileQueueSchema = SchemaFactory.createForClass(AfsExcelFileQueue);
@Schema({ _id: false })
export class AfsExcelFileItem {
  @Prop({ type: Number, default: -1 })
  overallConfidenceScore: number;

  @Prop({ type: String })
  digitizationMsg?: string;

  @Prop({
    type: String,
    enum: Object.values(DigitizationStatuses),
    default: DigitizationStatuses.NOT_DIGITIZED,
  })
  digitizationStatus: DigitizationStatuses; // e.g. "not-started","completed", "failed"

  @Prop({ type: Number })
  totalProcessingTimeMs?: number;

  @Prop({ type: String })
  requestId: string;

  /** Digitization pipeline version FastAPI stamped on this file's job (e.g. "v3"); absent on older records */
  @Prop({ type: String })
  version?: string;

  /** Enqueue run this file was queued in (digitization v3); also sent to FastAPI as `batch_id` */
  @Prop({ type: String })
  batchId?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: String, enum: Object.values(UploadedBy) })
  uploadedBy: UploadedBy; // e.g. "ULB", "AFS"

  // @Prop({ type: String })
  // fileUrl: string;

  // @Prop({ type: String })
  // s3Key: string;

  @Prop({ type: String })
  pdfUrl: string;

  @Prop({ type: Number })
  noOfPages: number;

  /** Size of the source PDF in bytes (same meaning as `pdf.fileSizeBytes` on the annual account's PDF) */
  @Prop({ type: Number })
  fileSizeBytes?: number;

  @Prop({ type: String })
  excelUrl: string;

  // data is an array; content is dynamic, so use Mixed
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  data: any[];

  // ---- AFS digitization v3 (summary only; the full extraction stays in FastAPI) ----
  // default: undefined keeps these absent on items that were not digitized by v3.

  // Distinct doc types actually present in the PDF
  @Prop({ type: [String], default: undefined })
  detectedDocTypes?: string[];

  // Page range for each doc type found
  @Prop({ type: [AfsDigitizationV3SegmentSchema], default: undefined })
  segments?: AfsDigitizationV3Segment[];

  // True when more than one distinct doc type is present
  @Prop({ type: Boolean })
  isConsolidated?: boolean;

  /** @deprecated Now `scores.isMismatch`. Still read as a fallback for files digitized before the move. */
  @Prop({ type: Boolean })
  isMismatch?: boolean;

  /** Quality scores of the finished job; absent on files digitized before they were stored */
  @Prop({ type: AfsDigitizationV3ScoresSchema, default: undefined })
  scores?: AfsDigitizationV3Scores;

  @Prop({ type: QueueSchema })
  queue: Queue;}

const AfsExcelFileItemSchema = SchemaFactory.createForClass(AfsExcelFileItem);

@Schema({ collection: 'afs_xl_files' })
export class AfsExcelFile {
  // @Prop({ type: String, required: true })
  // ulbId: string; // original string ID

  // new ObjectId field referencing AnnualAccountData collection
  @Prop({ type: Types.ObjectId, ref: 'AnnualAccountData' })
  annualAccountsId: Types.ObjectId;

  // new ObjectId field referencing ulb collection
  @Prop({ type: Types.ObjectId, ref: 'Ulb' })
  ulb: Types.ObjectId;

  // new ObjectId field referencing Year collection
  @Prop({ type: Types.ObjectId, ref: 'Year' })
  year: Types.ObjectId;

  // @Prop({ type: String, required: true })
  // financialYear: string; // e.g. "2020-21"

  @Prop({ type: String, enum: Object.values(AuditType), required: true })
  auditType: AuditType; // e.g. "audited"

  @Prop({ type: String, required: true })
  docType: string; // e.g. "bal_sheet_schedules"

  @Prop({ type: AfsExcelFileItemSchema })
  ulbFile: AfsExcelFileItem;

  @Prop({ type: AfsExcelFileItemSchema })
  afsFile: AfsExcelFileItem;

}

export const AfsExcelFileSchema = SchemaFactory.createForClass(AfsExcelFile);

// Optional: useful index for queries
AfsExcelFileSchema.index({ ulb: 1, year: 1, auditType: 1, docType: 1 }, { unique: true });

AfsExcelFileSchema.index({ 'ulbFile.requestId': 1 });
AfsExcelFileSchema.index({ 'afsFile.requestId': 1 });
AfsExcelFileSchema.index({ 'ulbFile.queue.status': 1 });
AfsExcelFileSchema.index({ 'afsFile.queue.status': 1 });
