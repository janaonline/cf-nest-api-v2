import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class AfsReuploadedPdf {
  @Prop({ type: Types.ObjectId, ref: 'Ulb', required: true })
  ulbId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Year', required: true })
  financialYear: Types.ObjectId;

  @Prop({ enum: ['audited', 'unAudited'], required: true })
  auditType: string;

  @Prop({ type: String, required: true })
  docType: string;

  @Prop({ type: String, required: true })
  s3Key: string;

  @Prop({ type: String, required: true })
  fileUrl: string;
}

export type AfsReuploadedPdfDocument = AfsReuploadedPdf & Document;
export const AfsReuploadedPdfSchema = SchemaFactory.createForClass(AfsReuploadedPdf);
AfsReuploadedPdfSchema.index({ ulbId: 1, financialYear: 1, auditType: 1, docType: 1 }, { unique: true });
