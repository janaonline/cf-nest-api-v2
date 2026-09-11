import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** PER_YEAR: normal, submit every design year. ONCE_EVER: submit once, reused across every year (e.g. PFMS). */
export type SubmissionScope = 'PER_YEAR' | 'ONCE_EVER';

/**
 * Stable, per-formId form behavior config - never per design year, because a form's data
 * requirements (does it support new-ULB exemption, how many years of grace, is it a one-time
 * submission) do not change annually the way its questionnaire (formjsons) does. Keeping this
 * out of formjsons avoids re-entering the same value on every new year's document.
 */
@Schema({
  collection: 'formjsonconfigs',
  timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' },
})
export class FormJsonConfig {
  @Prop({ type: Number, required: true, unique: true, index: true })
  formId!: number;

  /** Whether a genuinely new ULB can be exempted from this form via noPriorDataFormIds/yearAccess. */
  @Prop({ type: Boolean, default: false })
  isApplicableForExemption!: boolean;

  /** How many of the ULB's own initial participating years this form stays exempted for. */
  @Prop({ type: Number, default: 1, min: 1 })
  exemptionGraceYears!: number;

  @Prop({ type: String, enum: ['PER_YEAR', 'ONCE_EVER'], default: 'PER_YEAR' })
  submissionScope!: SubmissionScope;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;
}

export type FormJsonConfigDocument = FormJsonConfig & Document;
export const FormJsonConfigSchema = SchemaFactory.createForClass(FormJsonConfig);
