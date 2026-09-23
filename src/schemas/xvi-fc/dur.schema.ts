import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS, getFormStatusLabel, type FormStatusType } from 'src/common/constants/form-status.constants';
import {
  CurrentUpload,
  CurrentUploadSchema,
  DecisionInfo,
  DecisionInfoSchema,
  DocumentItem,
  DocumentItemSchema,
  UserInfo,
  UserInfoSchema,
} from './annual-account.schema';

// Reused as-is — these sub-schemas are already form-agnostic (see manual-review-request.schema.ts
// and xvi-fc-bank-account.schema.ts, which do the same). DUR's `documents` array uses the
// identical shape: two fixed slots ('tiedGrant', 'untiedGrant'), each carrying its own
// upload/OCR/manual-review/cooldown state, exactly like an Annual Account section's per-document array.
export { CurrentUpload, CurrentUploadSchema, DecisionInfo, DecisionInfoSchema, DocumentItem, DocumentItemSchema };

export type XviFcDurDocId = 'tiedGrant' | 'untiedGrant';
export const DUR_DOC_IDS: XviFcDurDocId[] = ['tiedGrant', 'untiedGrant'];

export type XviFcDurDocument = HydratedDocument<XviFcDur>;

/**
 * One document per {ulb, design_year} — the Detailed Utilisation Report for the ULB's prior-award
 * (15th FC) tied/untied grants, required alongside the first 16th-FC instalment claim. Two fixed
 * document slots (`documents[].docId`: 'tiedGrant' | 'untiedGrant'), each independently uploaded
 * and OCR-validated (Gemini-based, via DUR_VALIDATION_QUEUE / dur-validation/jobs — see
 * dur-validation-api.service.ts), sharing the exact retry/manual-review/cooldown state machine
 * Annual Accounts uses (common/utils/manual-review-cooldown.util.ts).
 *
 * Full Bank-Account-shape lifecycle (STATE then MoHUA) — same shared numeric `FORM_STATUS` as
 * Bank Account, not Annual Account's own bespoke string-enum/id pair.
 */
@Schema({
  collection: 'xvifc_dur_forms',
  timestamps: true,
  versionKey: false,
})
export class XviFcDur {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  design_year!: Types.ObjectId;

  @Prop({ type: [DocumentItemSchema], default: [] })
  documents!: DocumentItem[];

  /** Set once, at the first confirmed upload of either document — both tiedGrant/untiedGrant
   *  share one financial year for the whole form, so a retry can read it back from here instead
   *  of the caller having to resupply it. */
  @Prop({ type: String, default: null })
  financialYear!: string | null;

  @Prop({
    type: Number,
    enum: [
      FORM_STATUS.NOT_STARTED,
      FORM_STATUS.IN_PROGRESS,
      FORM_STATUS.UNDER_REVIEW_BY_STATE,
      FORM_STATUS.RETURNED_BY_STATE,
      FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      FORM_STATUS.RETURNED_BY_MOHUA,
      FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
      FORM_STATUS.APPROVED_BY_STATE,
      FORM_STATUS.EXEMPTED_ACKNOWLEDGED,
    ],
    default: FORM_STATUS.NOT_STARTED,
  })
  currentFormStatus!: FormStatusType;

  /** Human-readable label mirroring currentFormStatus — persisted so the status is readable directly from Mongo. */
  @Prop({ type: String, default: getFormStatusLabel(FORM_STATUS.NOT_STARTED) })
  currentFormStatusLabel!: string;

  @Prop({ type: UserInfoSchema, default: null })
  declaredBy!: UserInfo | null;

  /** Set once, the moment the ULB submits to STATE. */
  @Prop({ type: Date, default: null })
  declaredAt!: Date | null;

  /** Set once, the moment this form first transitions to IN_PROGRESS — dwell-time anchor for a
   *  future ULB reminder cron (not wired to one yet). */
  @Prop({ type: Date, default: null })
  inProgressSince!: Date | null;

  /** See XviFcBankAccount.lastReminderSentAt for the shared rationale (one timestamp, not a
   *  stored day count). */
  @Prop({ type: Date, default: null })
  lastReminderSentAt!: Date | null;

  /** Current/latest STATE decision on the whole form — null until STATE makes a final call. */
  @Prop({ type: DecisionInfoSchema, default: null })
  stateDecision!: DecisionInfo | null;

  /** Current/latest MoHUA decision — null until MoHUA acts on what STATE handed off. */
  @Prop({ type: DecisionInfoSchema, default: null })
  mohuaDecision!: DecisionInfo | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  modifiedBy!: Types.ObjectId;

  // -- xvi-fc dynamic year access: automatic exemption stub, never edited by a ULB --------
  @Prop({ type: Boolean, default: false })
  isExemptionStub?: boolean;

  @Prop({ type: Date })
  exemptionMaterializedAt?: Date;
}

export const XviFcDurSchema = SchemaFactory.createForClass(XviFcDur);

XviFcDurSchema.index({ ulb: 1, design_year: 1 }, { unique: true });
XviFcDurSchema.index({ state: 1, design_year: 1 });
