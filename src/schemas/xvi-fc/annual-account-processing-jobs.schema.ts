import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type XviFcAnnualAccountProcessingJobDocument = HydratedDocument<XviFcAnnualAccountProcessingJob>;

@Schema({ _id: false, versionKey: false })
class QueueInfo {
  @Prop({ required: true })
  name: string;

  @Prop({ type: String, default: null })
  bullJobId: string | null;

  @Prop({ default: 'waiting' })
  status: string;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ default: 3 })
  maxAttempts: number;
}

const QueueInfoSchema = SchemaFactory.createForClass(QueueInfo);

@Schema({ _id: false, versionKey: false })
class JobOCRSnapshot {
  @Prop({ type: String, default: null })
  jobId: string | null;

  @Prop({ type: String, default: null })
  status: string | null;

  @Prop({ type: String, default: null })
  progressStep: string | null;
}

const JobOCRSnapshotSchema = SchemaFactory.createForClass(JobOCRSnapshot);

@Schema({
  collection: 'xvifc_annualaccount_processing_jobs',
  timestamps: true,
  versionKey: false,
})
export class XviFcAnnualAccountProcessingJob {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcAnnualAccount', required: true })
  annualAccountId: Types.ObjectId;

  @Prop({ required: true })
  uploadId: string;

  @Prop({ required: true })
  section: string;

  @Prop({ required: true })
  requirementId: string;

  @Prop({ required: true })
  docId: string;

  @Prop({ type: QueueInfoSchema, required: true })
  queue: QueueInfo;

  @Prop({ type: JobOCRSnapshotSchema, default: () => ({}) })
  ocrJob: JobOCRSnapshot;

  @Prop({
    type: String,
    enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING'],
    default: 'PENDING',
  })
  status: string;

  @Prop({ type: String, default: null })
  error: string | null;

  @Prop({ type: Date, default: null })
  startedAt: Date | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;
}

export const XviFcAnnualAccountProcessingJobSchema = SchemaFactory.createForClass(
  XviFcAnnualAccountProcessingJob,
);

XviFcAnnualAccountProcessingJobSchema.index({ uploadId: 1 });
XviFcAnnualAccountProcessingJobSchema.index({ status: 1 });
XviFcAnnualAccountProcessingJobSchema.index({ 'ocrJob.jobId': 1 }, { sparse: true });
XviFcAnnualAccountProcessingJobSchema.index({ createdAt: -1 });
