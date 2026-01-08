import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// ---------- RowItem ----------
@Schema({ _id: false })
export class RowItem {
  @Prop({ type: String })
  title: string;

  @Prop({ type: String })
  value?: string;
}

export const RowItemSchema = SchemaFactory.createForClass(RowItem);

// ---------- DataRow ----------
@Schema()
export class DataRow {
  @Prop({ type: [RowItemSchema] })
  row: RowItem[];
}

export const DataRowSchema = SchemaFactory.createForClass(DataRow);

// ---------- File ----------
@Schema()
export class File {
  @Prop({ type: String, required: true })
  s3Key: string;

  @Prop({ type: String, required: true })
  fileUrl: string;

  @Prop()
  requestId?: string;

  @Prop({ type: Date, default: Date.now })
  uploadedAt: Date;

  @Prop({ enum: ['ULB', 'AFS'], required: true })
  uploadedBy: 'ULB' | 'AFS';

  @Prop({ type: [DataRowSchema] })
  data: DataRow[];
}
export const FileSchema = SchemaFactory.createForClass(File);

/**
 * ------------------------------------------------------------
 *                          ROOT SCHEMA
 * ------------------------------------------------------------
 */
@Schema({ timestamps: true })
export class AfsGeneratedExcel {
  @Prop({ type: Types.ObjectId, ref: 'Ulb', required: true })
  ulbId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Year', required: true })
  financialYear: Types.ObjectId;

  @Prop({ enum: ['audited', 'unAudited'], required: true })
  auditType: 'audited' | 'unAudited';

  @Prop({ type: String, required: true })
  docType: string;

  @Prop({ type: [FileSchema], required: true })
  files: File[];
}

export type AfsGeneratedExcelDocument = AfsGeneratedExcel & Document;
export const AfsGeneratedExcelSchema = SchemaFactory.createForClass(AfsGeneratedExcel);
AfsGeneratedExcelSchema.index({ ulbId: 1, financialYear: 1, auditType: 1, docType: 1 });
