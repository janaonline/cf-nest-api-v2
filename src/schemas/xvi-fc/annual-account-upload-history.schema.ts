import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  FileInfo,
  FileInfoSchema,
  OCRInfo,
  OCRInfoSchema,
  UserInfo,
  UserInfoSchema,
} from './annual-account.schema';

export type XviFcAnnualAccountUploadHistoryDocument = HydratedDocument<XviFcAnnualAccountUploadHistory>;

@Schema({ _id: false, versionKey: false })
class QueueInfo {
  @Prop({ required: true }) name: string;
  @Prop({ type: String, default: null }) bullJobId: string | null;
  @Prop({ default: 'waiting' }) status: string;
  @Prop({ default: 0 }) attempts: number;
  @Prop({ default: 3 }) maxAttempts: number;
}

const QueueInfoSchema = SchemaFactory.createForClass(QueueInfo);

@Schema({
  collection: 'xvifc_annualaccount_upload_history',
  timestamps: true,
  versionKey: false,
})
export class XviFcAnnualAccountUploadHistory {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcAnnualAccount', required: true })
  annualAccountId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  designYear: Types.ObjectId;

  @Prop({ required: true })
  section: string;

  @Prop({ required: true })
  docId: string;

  @Prop({ required: true, unique: true })
  uploadId: string;

  @Prop({ required: true })
  version: number;

  @Prop({ required: true })
  versionLabel: string;

  @Prop({ type: FileInfoSchema, required: true })
  file: FileInfo;

  @Prop({
    type: String,
    enum: ['NOT_STARTED', 'PROCESSING', 'PASSED', 'FAILED'],
    default: 'PROCESSING',
  })
  processingStatus: string;

  @Prop({ type: OCRInfoSchema, default: () => ({}) })
  ocrInfo: OCRInfo;

  @Prop({ type: QueueInfoSchema, required: true })
  queue: QueueInfo;

  @Prop({ type: String, default: null })
  error: string | null;

  @Prop({ type: Date, default: null })
  startedAt: Date | null;

  @Prop({ type: UserInfoSchema, required: true })
  userInfo: UserInfo;

  @Prop({ default: () => new Date() })
  uploadedAt: Date;
}

export const XviFcAnnualAccountUploadHistorySchema = SchemaFactory.createForClass(
  XviFcAnnualAccountUploadHistory,
);

XviFcAnnualAccountUploadHistorySchema.index({ uploadId: 1 }, { unique: true });
XviFcAnnualAccountUploadHistorySchema.index(
  { annualAccountId: 1, section: 1, docId: 1, version: 1 },
  { unique: true },
);
XviFcAnnualAccountUploadHistorySchema.index({ annualAccountId: 1, section: 1, docId: 1 });
XviFcAnnualAccountUploadHistorySchema.index({ 'ocrInfo.jobId': 1 }, { sparse: true });
XviFcAnnualAccountUploadHistorySchema.index({ processingStatus: 1 });
