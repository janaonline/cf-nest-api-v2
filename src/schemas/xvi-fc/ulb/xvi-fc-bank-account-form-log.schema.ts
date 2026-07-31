import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS, type FormStatusType } from 'src/common/constants/form-status.constants';
import { UserInfo, UserInfoSchema } from 'src/schemas/xvi-fc/annual-account.schema';

export type XviFcBankAccountFormLogDocument = HydratedDocument<XviFcBankAccountFormLog>;

export type BankAccountFormLogAction = 'SUBMITTED' | 'APPROVED' | 'RETURNED' | 'UNDO';
export type BankAccountFormLogActorStage = 'ULB' | 'STATE' | 'MOHUA';

/**
 * Append-only audit trail for bank account (PFMS) form events — one row per event
 * (ULB submit, or a state/MOHUA decision), never updated or deleted after insert.
 * Bank Account is a single flat form (no per-document array like Annual Accounts), so
 * each row already fully describes its own event — no nested documents[] breakdown needed.
 */
@Schema({
  collection: 'xvifc_bankaccount_form_logs',
  timestamps: true,
  versionKey: false,
})
export class XviFcBankAccountFormLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcBankAccount', required: true })
  bankAccountId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  designYear!: Types.ObjectId;

  @Prop({ type: String, enum: ['SUBMITTED', 'APPROVED', 'RETURNED', 'UNDO'], required: true })
  action!: BankAccountFormLogAction;

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
      FORM_STATUS.AWAITING_CLAIM_LETTER,
      FORM_STATUS.UNDO,
    ],
    required: true,
  })
  toStatus!: FormStatusType;

  /** Human-readable label mirroring toStatus — persisted so the history is readable directly from Mongo. */
  @Prop({ type: String, required: true })
  toStatusLabel!: string;

  @Prop({ type: String, enum: ['ULB', 'STATE', 'MOHUA'], required: true })
  actorStage!: BankAccountFormLogActorStage;

  @Prop({ type: UserInfoSchema, required: true })
  userInfo!: UserInfo;

  /** The decision note — visible to the ULB. Omitted (not stored as null) when there's no note. */
  @Prop({ type: String })
  note?: string;

  /** S3 object key of the proof document in place at the time of this event, when known. */
  @Prop({ type: String })
  filePath?: string;

  /** IFSC code in place at the time of this event — never changes after submission, but kept as a snapshot for readability. */
  @Prop({ type: String })
  ifscCode?: string;

  /** Masked account number in place at the time of this event. Never the plaintext/encrypted value — mirrors what's shown in the UI. */
  @Prop({ type: String })
  accountNumberMasked?: string;

  /** Correlates every row written by one bulk-decide request. Omitted outside bulk actions. */
  @Prop({ type: String })
  batchId?: string;
}

export const XviFcBankAccountFormLogSchema = SchemaFactory.createForClass(XviFcBankAccountFormLog);

XviFcBankAccountFormLogSchema.index({ bankAccountId: 1, createdAt: -1 });
XviFcBankAccountFormLogSchema.index({ ulb: 1, designYear: 1, createdAt: -1 });
XviFcBankAccountFormLogSchema.index({ batchId: 1 }, { sparse: true });
