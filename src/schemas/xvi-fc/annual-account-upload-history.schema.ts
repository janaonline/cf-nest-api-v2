import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  FileInfo,
  FileInfoSchema,
  OCRInfo,
  OCRInfoSchema,
  ValidationResult,
  ValidationResultSchema,
  UploaderInfo,
  UploaderInfoSchema,
} from './annual-account.schema';

export type XviFcAnnualAccountUploadHistoryDocument = HydratedDocument<XviFcAnnualAccountUploadHistory>;

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
  requirementId: string;

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

  @Prop({ type: ValidationResultSchema, default: () => ({}) })
  validationResult: ValidationResult;

  @Prop({ type: UploaderInfoSchema, required: true })
  uploadedBy: UploaderInfo;

  @Prop({ default: () => new Date() })
  uploadedAt: Date;
}

export const XviFcAnnualAccountUploadHistorySchema = SchemaFactory.createForClass(
  XviFcAnnualAccountUploadHistory,
);

XviFcAnnualAccountUploadHistorySchema.index({ uploadId: 1 }, { unique: true });
XviFcAnnualAccountUploadHistorySchema.index(
  { annualAccountId: 1, section: 1, requirementId: 1, version: 1 },
  { unique: true },
);
XviFcAnnualAccountUploadHistorySchema.index({ annualAccountId: 1, section: 1, requirementId: 1 });
XviFcAnnualAccountUploadHistorySchema.index({ 'ocrInfo.jobId': 1 }, { sparse: true });
