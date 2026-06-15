import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FormJsonDocument = FormJson & Document;

/**
 * Form template / questionnaire definition. Reuses the existing formjsons collection.
 * Defines rendering, fields, and validation for a form in a given design year.
 */
@Schema({
  collection: 'formjsons',
  timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' },
})
export class FormJson {
  @Prop({ type: Types.ObjectId, ref: 'Year', required: true, index: true })
  design_year!: Types.ObjectId;

  @Prop({ type: Number })
  formId?: number;

  @Prop({ type: String, index: true })
  type?: string;

  @Prop({ type: [Object], default: [] })
  data?: Record<string, unknown>[];

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;
}

export const FormJsonSchema = SchemaFactory.createForClass(FormJson);

// Existing unique constraint on the collection
FormJsonSchema.index({ design_year: 1, formId: 1 }, { unique: true, name: 'unique_form_per_year' });
FormJsonSchema.index({ type: 1, isActive: 1 });
