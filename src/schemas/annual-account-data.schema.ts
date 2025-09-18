import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

// ---- Shared helper schemas ----

const statusEnum = ['PENDING', 'APPROVED', 'REJECTED', 'N/A', ''] as const;
const auditStatusEnum = ['Audited', 'Unaudited'] as const;

@Schema({ _id: false })
class PdfFile {
  @Prop() url: string;
  @Prop() name: string;
}
const PdfFileSchema = SchemaFactory.createForClass(PdfFile);

@Schema({ _id: false })
class Content {
  @Prop() pdf: PdfFile;

  @Prop() excel: PdfFile;

  @Prop({
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'N/A', null],
  })
  status: string;

  @Prop({ default: '' }) rejectReason: string;

  @Prop() responseFile: PdfFile;

  @Prop({ default: '' }) rejectReason_state: string;

  @Prop({ default: '' }) rejectReason_mohua: string;

  @Prop() responseFile_state: PdfFile;

  @Prop() responseFile_mohua: PdfFile;
}
const ContentSchema = SchemaFactory.createForClass(Content);

@Schema({ _id: false })
class ContentPDF {
  @Prop() pdf: PdfFile;

  @Prop({
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'N/A', null],
  })
  status: string;

  @Prop({ default: '' }) rejectReason: string;

  @Prop() responseFile: PdfFile;

  @Prop({ default: '' }) rejectReason_state: string;

  @Prop({ default: '' }) rejectReason_mohua: string;

  @Prop() responseFile_state: PdfFile;

  @Prop() responseFile_mohua: PdfFile;
}
const ContentPDFSchema = SchemaFactory.createForClass(ContentPDF);

@Schema({ _id: false })
class ProvisionalData {
  @Prop() bal_sheet: Content;

  @Prop() assets: number;

  @Prop() f_assets: number;

  @Prop() s_grant: number;

  @Prop() c_grant: number;

  @Prop() bal_sheet_schedules: Content;

  @Prop() inc_exp: Content;

  @Prop() revenue: number;

  @Prop() expense: number;

  @Prop() inc_exp_schedules: Content;

  @Prop() cash_flow: Content;

  @Prop() auditor_report: ContentPDF;
}
const ProvisionalDataSchema = SchemaFactory.createForClass(ProvisionalData);

@Schema({ _id: false })
class StandardizedData {
  @Prop() excel: PdfFile;

  @Prop({ default: null }) declaration: boolean;
}
const StandardizedDataSchema = SchemaFactory.createForClass(StandardizedData);

@Schema({ _id: false })
class FormData {
  @Prop() provisional_data: ProvisionalData;

  @Prop() standardized_data: StandardizedData;

  @Prop({ type: String, enum: ['APPROVED', 'REJECTED', 'PENDING'] })
  status: string;

  @Prop({ default: '' }) rejectReason: string;

  @Prop() responseFile: PdfFile;

  @Prop({ default: '' }) rejectReason_state: string;

  @Prop({ default: '' }) rejectReason_mohua: string;

  @Prop() responseFile_state: PdfFile;

  @Prop() responseFile_mohua: PdfFile;

  @Prop({ type: String, enum: auditStatusEnum })
  audit_status: string;

  @Prop({ default: null }) submit_annual_accounts: boolean;

  @Prop({ default: null }) submit_standardized_data: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year: string;
}
const FormDataSchema = SchemaFactory.createForClass(FormData);

// ---- Main AnnualAccountData Schema ----

@Schema({
  timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' },
})
export class AnnualAccountData extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  design_year: string;

  @Prop({ type: String, enum: statusEnum })
  status: string;

  @Prop({ type: Boolean, default: false, required: true })
  isDraft: boolean;

  @Prop({ type: Array, default: [] })
  history: any[];

  @Prop() audited: FormData;

  @Prop() unAudited: FormData;

  @Prop({ default: Date.now }) modifiedAt: Date;

  @Prop() ulbSubmit: Date;

  @Prop({ default: Date.now }) createdAt: Date;

  @Prop({ default: 1 }) isActive: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  actionTakenBy: string;

  @Prop({ default: null }) actionTakenByRole: string;

  @Prop() currentFormStatus: number;
}

export const AnnualAccountDataSchema =
  SchemaFactory.createForClass(AnnualAccountData);

AnnualAccountDataSchema.index({ ulb: 1, design_year: 1 }, { unique: true });
