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

@Schema({ _id: false, versionKey: false })
class DocumentUploader {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  role: string;
}

const DocumentUploaderSchema = SchemaFactory.createForClass(DocumentUploader);

@Schema({ _id: false, versionKey: false })
class DocumentEntry {
  @Prop({ required: true })
  docId: string;

  @Prop({ required: true })
  type: string;

  @Prop()
  fileName?: string;

  @Prop()
  fileSize?: number;

  @Prop({ default: 0 })
  pages: number;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  filePath: string;

  @Prop()
  fileUrl?: string;

  @Prop({ default: 'v1' })
  version: string;

  @Prop({ type: DocumentUploaderSchema, required: true })
  userInfo: DocumentUploader;

  @Prop({ default: () => new Date() })
  uploadedAt: Date;
}

const DocumentEntrySchema = SchemaFactory.createForClass(DocumentEntry);

@Schema({ _id: false, versionKey: false })
class YearSection {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  yearId: Types.ObjectId;

  @Prop({ required: true })
  year: string;

  @Prop({ type: [DocumentEntrySchema], default: [] })
  documents: DocumentEntry[];
}

const YearSectionSchema = SchemaFactory.createForClass(YearSection);

@Schema({
  collection: 'xvi_fc_annualaccount_datas',
  timestamps: true,
  versionKey: false,
})
export class XviFcAnnualAccount {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  design_year: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb: Types.ObjectId;

  @Prop({ type: YearSectionSchema })
  auditedData?: YearSection;

  @Prop({ type: YearSectionSchema })
  unauditedData?: YearSection;

  /** Submission lifecycle — mirrors the old isDraft + status pattern from 15th FC. */
  @Prop({
    type: String,
    enum: Object.values(AnnualAccountStatus),
    default: AnnualAccountStatus.DRAFT,
  })
  status: AnnualAccountStatus;

  @Prop({ type: Boolean, default: true })
  isDraft: boolean;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  modifiedBy: Types.ObjectId;
}

export const XviFcAnnualAccountSchema = SchemaFactory.createForClass(XviFcAnnualAccount);

XviFcAnnualAccountSchema.index({ ulb: 1, design_year: 1 }, { unique: true });
