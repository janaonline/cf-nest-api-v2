// afs-excel-file.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

export type AfsExcelFileDocument = HydratedDocument<AfsExcelFile>;

export enum QueueStatus {
  ON_THE_JOB = 'on-the-job',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PROCESSING = 'processing',
  WAITING = 'waiting',
  QUEUED = 'queued',
}

@Schema()
export class AfsExcelFileQueue {
  @Prop({ type: String })
  jobId: string;

  @Prop({ type: String, enum: Object.values(QueueStatus) })
  status: string;

  @Prop({ type: Number }) // 0-100
  progress: number;

  @Prop({ type: String, required: false })
  failedReason?: string;

  @Prop({ type: Number, required: false })
  startedOn?: number;

  @Prop({ type: Date })
  queuedAt: Date;

  @Prop({ type: Number })
  attemptsMade: number;

  @Prop({ type: Number, required: false })
  processedOn?: number;

  @Prop({ type: Number, required: false })
  finishedOn?: number;
}

export const AfsExcelFileQueueSchema = SchemaFactory.createForClass(AfsExcelFileQueue);
@Schema({ _id: false })
export class AfsExcelFileItem {
  @Prop({ type: Number, default: -1 })
  overallConfidenceScore: number;

  @Prop({ type: String })
  requestId: string;

  @Prop({ type: Date })
  uploadedAt: Date;

  @Prop({ type: String, enum: ['ULB', 'AFS'] })
  uploadedBy: string; // e.g. "ULB", "AFS"

  // @Prop({ type: String })
  // fileUrl: string;

  // @Prop({ type: String })
  // s3Key: string;

  @Prop({ type: String })
  pdfUrl: string;

  @Prop({ type: String })
  excelUrl: string;

  // data is an array; content is dynamic, so use Mixed
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  data: any[];

  @Prop({ type: AfsExcelFileQueueSchema })
  queue: AfsExcelFileQueue;
}

const AfsExcelFileItemSchema = SchemaFactory.createForClass(AfsExcelFileItem);

@Schema({ collection: 'afsexcelfiles' })
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

  @Prop({ type: String, required: true })
  auditType: string; // e.g. "audited"

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
