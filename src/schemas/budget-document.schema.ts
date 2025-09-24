import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// File Subdocument
@Schema({ _id: false })
export class File {
  @Prop({ type: Number, required: true, default: 3 })
  currentFormStatus: number;

  @Prop({ type: String, required: true })
  type: string;

  @Prop({ type: String, required: true })
  url: string;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: String, required: [true, 'Source is required'] })
  source: string;
}
export const FileSchema = SchemaFactory.createForClass(File);

// YearData Subdocument
@Schema({ _id: false })
export class YearData {
  @Prop({
    type: Types.ObjectId,
    ref: 'Year',
    required: [true, 'Design Year is required'],
  })
  designYearId: Types.ObjectId;

  @Prop({ type: String, required: true })
  designYear: string;

  @Prop({ type: Number, required: true })
  sequence: number;

  @Prop({ type: [FileSchema], default: [] })
  files: File[];

  // @Prop({ type: Types.ObjectId, ref: 'user', default: null })
  // uploadedBy: Types.ObjectId | null;
}
export const YearDataSchema = SchemaFactory.createForClass(YearData);

/**
 * ---------------------------------------------
 *                    ROOT SCHEMA
 * ---------------------------------------------
 */
@Schema({ timestamps: true })
export class BudgetDocument extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: 'Ulb',
    required: [true, 'ULB ID is required'],
  })
  ulb: Types.ObjectId;

  @Prop({ type: [YearDataSchema], default: [] })
  yearsData: YearData[];
}

export type BudgetDocumentDoc = BudgetDocument & Document;
export const BudgetDocumentSchema =
  SchemaFactory.createForClass(BudgetDocument);

BudgetDocumentSchema.index({ ulb: 1 }, { unique: true });
