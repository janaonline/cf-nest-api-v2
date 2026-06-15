import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { FORM_STATUS } from '../../common/constants/form-status.constants';

export type FormSubmissionDocument = FormSubmission & Document;

/**
 * Workflow register for a form data record. Stores only status, ownership, and audit fields.
 * Actual form data lives in the collection named by formDataCollection (e.g. annualaccounts).
 */
@Schema({ timestamps: true, collection: 'form_submissions' })
export class FormSubmission {
  @Prop({ type: String, required: true, index: true })
  formType!: string;

  @Prop({ type: String, required: true })
  formName!: string;

  @Prop({ type: Number })
  formId?: number;

  @Prop({ type: Types.ObjectId, ref: 'FormJson' })
  formJsonId?: Types.ObjectId;

  @Prop({ type: String, required: true })
  formDataCollection!: string;

  @Prop({ type: Types.ObjectId, required: true })
  formDataId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Year', required: true, index: true })
  designYear!: Types.ObjectId;

  @Prop({ type: String, index: true })
  financialYear?: string;

  @Prop({ type: String, required: true, enum: ['ULB', 'STATE', 'MOHUA'] })
  ownerType!: string;

  @Prop({ type: Types.ObjectId, ref: 'Ulb', index: true })
  ulbId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'State', index: true })
  stateId?: Types.ObjectId;

  @Prop({ type: Number, default: FORM_STATUS.NOT_STARTED })
  currentFormStatus!: number;

  @Prop({ type: String })
  currentOwnerOrgType?: string;

  @Prop({ type: Types.ObjectId })
  currentOwnerOrgId?: Types.ObjectId;

  @Prop({ type: String })
  currentOwnerRoleCode?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  submittedBy?: Types.ObjectId;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lastActionBy?: Types.ObjectId;

  @Prop({ type: Date })
  lastActionAt?: Date;
}

export const FormSubmissionSchema = SchemaFactory.createForClass(FormSubmission);

// ── Unique indexes ────────────────────────────────────────────────────────────
// Prevents duplicate workflow records for the same form data document
FormSubmissionSchema.index(
  { formType: 1, formDataCollection: 1, formDataId: 1 },
  { unique: true, name: 'unique_form_data_link' },
);

// One workflow record per ULB per form type per year
FormSubmissionSchema.index(
  { formType: 1, ulbId: 1, designYear: 1 },
  { unique: true, sparse: true, name: 'unique_ulb_form_per_year', partialFilterExpression: { ownerType: 'ULB' } },
);

// One workflow record per State per form type per year
FormSubmissionSchema.index(
  { formType: 1, stateId: 1, designYear: 1 },
  { unique: true, sparse: true, name: 'unique_state_form_per_year', partialFilterExpression: { ownerType: 'STATE' } },
);

// ── Query indexes ─────────────────────────────────────────────────────────────
FormSubmissionSchema.index({ financialYear: 1, currentFormStatus: 1 });
FormSubmissionSchema.index({ ulbId: 1, designYear: 1 });
FormSubmissionSchema.index({ stateId: 1, designYear: 1 });
FormSubmissionSchema.index({ designYear: 1, formType: 1 });
FormSubmissionSchema.index({ formDataCollection: 1, formDataId: 1 });
FormSubmissionSchema.index({ lastActionAt: -1 });
