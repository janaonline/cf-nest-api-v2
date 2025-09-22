import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

// --------------------------------------------
//            ENUM DEFINITIONS
// --------------------------------------------
export const STATUS_ENUM = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'N/A',
  '',
] as const;
export type StatusEnumType = (typeof STATUS_ENUM)[number];

export const AUDIT_STATUS_ENUM = ['Audited', 'Unaudited'] as const;
export type AuditStatusEnumType = (typeof AUDIT_STATUS_ENUM)[number];

export const FORMDATA_STATUS_ENUM = [
  'APPROVED',
  'REJECTED',
  'PENDING',
] as const;
export type FormDataStatusEnumType = (typeof FORMDATA_STATUS_ENUM)[number];

/**
 * ---------------------------------------------
 *                EMBEDDED SCHEMAS
 * ---------------------------------------------
 */
//  File object (PDF or Excel).
//  Stores metadata about uploaded files.
@Schema({ _id: false })
class PdfFile {
  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  name: string;
}
export const PdfFileSchema = SchemaFactory.createForClass(PdfFile);

// Generic content schema used for balance sheet, schedules, income-expense, etc.
@Schema({ _id: false })
class Content {
  @Prop({ type: PdfFileSchema })
  pdf: PdfFile;

  @Prop({ type: PdfFileSchema })
  excel: PdfFile;

  @Prop({
    type: String,
    enum: [...STATUS_ENUM, null],
    default: 'PENDING',
  })
  status: StatusEnumType;

  @Prop({ default: '' })
  rejectReason: string;

  @Prop({ type: PdfFileSchema })
  responseFile: PdfFile;

  @Prop({ default: '' })
  rejectReason_state: string;

  @Prop({ default: '' })
  rejectReason_mohua: string;

  @Prop({ type: PdfFileSchema })
  responseFile_state: PdfFile;

  @Prop({ type: PdfFileSchema })
  responseFile_mohua: PdfFile;
}
export const ContentSchema = SchemaFactory.createForClass(Content);

// Auditor report schema (similar to Content but only for PDF).
@Schema({ _id: false })
class ContentPDF {
  @Prop({ type: PdfFileSchema })
  pdf: PdfFile;

  @Prop({ type: String, enum: STATUS_ENUM })
  status: StatusEnumType;

  @Prop({ default: '' })
  rejectReason: string;

  @Prop({ type: PdfFileSchema })
  responseFile: PdfFile;

  @Prop({ default: '' })
  rejectReason_state: string;

  @Prop({ default: '' })
  rejectReason_mohua: string;

  @Prop({ type: PdfFileSchema })
  responseFile_state: PdfFile;

  @Prop({ type: PdfFileSchema })
  responseFile_mohua: PdfFile;
}
export const ContentPDFSchema = SchemaFactory.createForClass(ContentPDF);

// Provisional Data schema – stores unaudited/initial financial data.
@Schema({ _id: false })
class ProvisionalData {
  @Prop({ type: ContentSchema })
  bal_sheet: Content;

  @Prop() assets: number;

  @Prop() f_assets: number;

  @Prop() s_grant: number;

  @Prop() c_grant: number;

  @Prop({ type: ContentSchema })
  bal_sheet_schedules: Content;

  @Prop({ type: ContentSchema })
  inc_exp: Content;

  @Prop() revenue: number;

  @Prop() expense: number;

  @Prop({ type: ContentSchema })
  inc_exp_schedules: Content;

  @Prop({ type: ContentSchema })
  cash_flow: Content;

  @Prop({ type: ContentPDFSchema })
  auditor_report: ContentPDF;
}
export const ProvisionalDataSchema =
  SchemaFactory.createForClass(ProvisionalData);

// Standardized Data schema – represents structured formats required by regulators.
@Schema({ _id: false })
class StandardizedData {
  @Prop({ type: PdfFileSchema })
  excel: PdfFile;

  @Prop({ default: null })
  declaration: boolean;
}
export const StandardizedDataSchema =
  SchemaFactory.createForClass(StandardizedData);

// Form Data schema – holds provisional + standardized data submissions.
@Schema({ _id: false })
class FormData {
  @Prop({ type: ProvisionalDataSchema })
  provisional_data: ProvisionalData;

  @Prop({ type: StandardizedDataSchema })
  standardized_data: StandardizedData;

  @Prop({ type: String, enum: FORMDATA_STATUS_ENUM })
  status: FormDataStatusEnumType;

  @Prop({ default: '' })
  rejectReason: string;

  @Prop({ type: PdfFileSchema })
  responseFile: PdfFile;

  @Prop({ default: '' })
  rejectReason_state: string;

  @Prop({ default: '' })
  rejectReason_mohua: string;

  @Prop({ type: PdfFileSchema })
  responseFile_state: PdfFile;

  @Prop({ type: PdfFileSchema })
  responseFile_mohua: PdfFile;

  @Prop({ type: String, enum: AUDIT_STATUS_ENUM })
  audit_status: AuditStatusEnumType;

  @Prop({ default: null })
  submit_annual_accounts: boolean;

  @Prop({ default: null })
  submit_standardized_data: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year: MongooseSchema.Types.ObjectId;
}
export const FormDataSchema = SchemaFactory.createForClass(FormData);

/**
 * ---------------------------------------------
 *                    ROOT SCHEMA
 * ---------------------------------------------
 */
// AnnualAccountData – Main collection storing audited & unaudited accounts.
@Schema({ timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } })
export class AnnualAccountData extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  design_year: MongooseSchema.Types.ObjectId;

  @Prop({ type: String, enum: STATUS_ENUM })
  status: StatusEnumType;

  @Prop({ type: Boolean, default: false, required: true })
  isDraft: boolean;

  @Prop({ type: Array, default: [] })
  history: Record<string, any>[];

  @Prop({ type: FormDataSchema })
  audited: FormData;

  @Prop({ type: FormDataSchema })
  unAudited: FormData;

  @Prop({ default: Date.now })
  modifiedAt: Date;

  @Prop() ulbSubmit: Date;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: 1 })
  isActive: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  actionTakenBy: MongooseSchema.Types.ObjectId;

  @Prop({ default: null })
  actionTakenByRole: string;

  @Prop()
  currentFormStatus: number;
}

export type AnnualAccountDataDocument = AnnualAccountData & Document;

export const AnnualAccountDataSchema =
  SchemaFactory.createForClass(AnnualAccountData);

// Compound index to ensure one record per ULB & Design Year.
AnnualAccountDataSchema.index({ ulb: 1, design_year: 1 }, { unique: true });
