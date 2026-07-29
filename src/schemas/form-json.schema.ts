import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { ClaimEligibilityConfig } from 'src/module/xvi-fc/common/types/claim-eligibility.type';

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
  data?: FieldConfig[];

  @Prop({ type: Object })
  meta?: Record<string, unknown>;

  // Loose at the Mongoose level (same treatment as `data`/`meta` above) — real enum/shape
  // validation happens at the DTO layer (ClaimEligibilityConfigDto), per brain §3.3's
  // "schema-validated enums, allowlisted actions; never arbitrary JavaScript/operators".
  @Prop({ type: Object, default: null })
  claimEligibility?: ClaimEligibilityConfig | null;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;
}

export const FormJsonSchema = SchemaFactory.createForClass(FormJson);

// Existing unique constraint on the collection
FormJsonSchema.index({ design_year: 1, formId: 1 }, { unique: true, name: 'unique_form_per_year' });
FormJsonSchema.index({ type: 1, isActive: 1 });
