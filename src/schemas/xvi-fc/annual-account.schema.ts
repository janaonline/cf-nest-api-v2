import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export enum AnnualAccountStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

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
}

export const OCRInfoSchema = SchemaFactory.createForClass(OCRInfo);

@Schema({ _id: false, versionKey: false })
export class ValidationResult {
  @Prop({ type: String, default: null })
  validationStatus: string | null;

  @Prop({ type: String, default: null })
  validationDetails: string | null;

  @Prop({ type: [String], default: [] })
  failedChecks: string[];
}

export const ValidationResultSchema = SchemaFactory.createForClass(ValidationResult);

@Schema({ _id: false, versionKey: false })
export class UploaderInfo {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  role: string;
}

export const UploaderInfoSchema = SchemaFactory.createForClass(UploaderInfo);

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

  @Prop({ type: ValidationResultSchema, default: () => ({}) })
  validationResult: ValidationResult;

  @Prop({ type: UploaderInfoSchema, required: true })
  uploadedBy: UploaderInfo;

  @Prop({ default: () => new Date() })
  uploadedAt: Date;
}

export const CurrentUploadSchema = SchemaFactory.createForClass(CurrentUpload);

// ─── DocumentItem ─────────────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class DocumentItem {
  @Prop({ required: true })
  requirementId: string;

  @Prop({ required: true })
  docId: string;

  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  expectedDocType: string;

  @Prop({ default: true })
  required: boolean;

  @Prop({ default: 0 })
  sortOrder: number;

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

// ─── SectionSummary ───────────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class SectionSummary {
  @Prop({ default: 0 })
  totalRequired: number;

  @Prop({ default: 0 })
  uploaded: number;

  @Prop({ default: 0 })
  processing: number;

  @Prop({ default: 0 })
  passed: number;

  @Prop({ default: 0 })
  failed: number;

  @Prop({ default: 0 })
  notUploaded: number;
}

export const SectionSummarySchema = SchemaFactory.createForClass(SectionSummary);

// ─── AnnualAccountSection ─────────────────────────────────────────────────────

@Schema({ _id: false, versionKey: false })
export class AnnualAccountSection {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  yearId: Types.ObjectId;

  @Prop({ required: true })
  year: string;

  @Prop({ type: SectionSummarySchema, default: () => ({}) })
  summary: SectionSummary;

  @Prop({ type: [DocumentItemSchema], default: [] })
  documents: DocumentItem[];
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
  ulb: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  design_year: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(AnnualAccountStatus),
    default: AnnualAccountStatus.DRAFT,
  })
  status: AnnualAccountStatus;

  @Prop({ type: Boolean, default: true })
  isDraft: boolean;

  @Prop({ type: Number, default: 1 })
  documentSetVersion: number;

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
