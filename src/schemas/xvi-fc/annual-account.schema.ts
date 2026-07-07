import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export enum AnnualAccountFormStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  UNDER_REVIEW_BY_STATE = 'UNDER_REVIEW_BY_STATE',
}

export const FORM_STATUS_ID: Record<AnnualAccountFormStatus, number> = {
  [AnnualAccountFormStatus.NOT_STARTED]: 1,
  [AnnualAccountFormStatus.IN_PROGRESS]: 2,
  [AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE]: 3,
};

export type XviFcAnnualAccountDocument = HydratedDocument<XviFcAnnualAccount>;

// ─── Shared sub-schemas ───────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class FileInfo {
  @Prop({ required: true })
  originalName: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ default: 0 })
  pages: number;

  @Prop({ default: 0 })
  sizeKb: number;

  @Prop({ required: true })
  s3Key: string;

  @Prop({ default: '' })
  sha256: string;
}

export const FileInfoSchema = SchemaFactory.createForClass(FileInfo);

@Schema({ _id: false, versionKey: false })
export class OCRInfo {
  @Prop({ type: String, default: null })
  jobId: string | null;

  @Prop({ type: String, default: null })
  status: string | null;

  @Prop({ type: String, default: null })
  progressStep: string | null;

  @Prop({ type: Date, default: null })
  submittedAt: Date | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: String, default: null })
  validationStatus!: string | null;

  @Prop({ type: String, default: null })
  validationDetails!: string | null;

  @Prop({ type: [String], default: [] })
  failedChecks!: string[];
}

export const OCRInfoSchema = SchemaFactory.createForClass(OCRInfo);

@Schema({ _id: false, versionKey: false })
export class UserInfo {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  role!: string;

  @Prop({ type: String, default: null })
  ipAddress!: string | null;

  @Prop({ type: String, default: null })
  userAgent!: string | null;
}

export const UserInfoSchema = SchemaFactory.createForClass(UserInfo);

// ─── CurrentUpload ────────────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class CurrentUpload {
  @Prop({ required: true })
  uploadId: string;

  @Prop({ required: true })
  version: number;

  @Prop({ required: true })
  versionLabel: string;

  @Prop({ type: FileInfoSchema, required: true })
  file: FileInfo;

  @Prop({ type: OCRInfoSchema, default: () => ({}) })
  ocrInfo!: OCRInfo;

  @Prop({ type: UserInfoSchema, required: true })
  userInfo!: UserInfo;

  @Prop({ default: () => new Date() })
  uploadedAt: Date;
}

export const CurrentUploadSchema = SchemaFactory.createForClass(CurrentUpload);

// ─── DocumentItem ─────────────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class DocumentItem {
  @Prop({ required: true })
  docId: string;

  @Prop({
    type: String,
    enum: ['NOT_UPLOADED', 'UPLOADED'],
    default: 'NOT_UPLOADED',
  })
  uploadStatus!: string;

  @Prop({
    type: String,
    enum: ['NOT_STARTED', 'PROCESSING', 'PASSED', 'FAILED'],
    default: 'NOT_STARTED',
  })
  processingStatus: string;

  @Prop({ type: CurrentUploadSchema, default: null })
  currentUpload: CurrentUpload | null;
}

export const DocumentItemSchema = SchemaFactory.createForClass(DocumentItem);

// ─── AnnualAccountSection ─────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class AnnualAccountSection {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  yearId: Types.ObjectId;

  @Prop({ required: true })
  year: string;

  @Prop({
    type: String,
    enum: Object.values(AnnualAccountFormStatus),
    default: AnnualAccountFormStatus.IN_PROGRESS,
  })
  form_status!: string;

  @Prop({ type: Number, default: FORM_STATUS_ID[AnnualAccountFormStatus.IN_PROGRESS] })
  form_status_id!: number;

  @Prop({ type: [DocumentItemSchema], default: [] })
  documents!: DocumentItem[];

  @Prop({ type: Boolean, default: false })
  selfDeclared!: boolean;

  @Prop({ type: UserInfoSchema, default: null })
  declaredBy: UserInfo | null;

  @Prop({ type: Date, default: null })
  declaredAt: Date | null;
}

export const AnnualAccountSectionSchema = SchemaFactory.createForClass(AnnualAccountSection);

// ─── Root document ────────────────────────────────────────────────────────────

@Schema({
  collection: 'xvifc_annualaccount_datas',
  timestamps: true,
  versionKey: false,
})
export class XviFcAnnualAccount {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  design_year!: Types.ObjectId;

  @Prop({ type: AnnualAccountSectionSchema, default: null })
  auditedData: AnnualAccountSection | null;

  @Prop({ type: AnnualAccountSectionSchema, default: null })
  unauditedData: AnnualAccountSection | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  modifiedBy: Types.ObjectId;
}

export const XviFcAnnualAccountSchema = SchemaFactory.createForClass(XviFcAnnualAccount);

XviFcAnnualAccountSchema.index({ ulb: 1, design_year: 1 }, { unique: true });
