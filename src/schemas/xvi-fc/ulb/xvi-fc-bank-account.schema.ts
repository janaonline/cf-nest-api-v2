import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS, getFormStatusLabel, type FormStatusType } from 'src/common/constants/form-status.constants';
import { DecisionInfo, DecisionInfoSchema } from 'src/schemas/xvi-fc/annual-account.schema';

export type XviFcBankAccountDocument = HydratedDocument<XviFcBankAccount>;

@Schema({ _id: false, versionKey: false })
export class XviFcBankAccountProofFile {
  @Prop({ type: String, required: true })
  originalName!: string;

  @Prop({ type: String, required: true })
  mimeType!: string;

  @Prop({ type: Number, default: null })
  pages!: number | null;

  @Prop({ type: Number, required: true })
  sizeKb!: number;

  @Prop({ type: String, required: true })
  s3Key!: string;

  @Prop({ type: String, required: true, match: /^[a-fA-F0-9]{64}$/ })
  sha256!: string;
}

export const XviFcBankAccountProofFileSchema = SchemaFactory.createForClass(XviFcBankAccountProofFile);

@Schema({
  collection: 'xvifc_bankaccounts',
  timestamps: true,
  versionKey: false,
})
export class XviFcBankAccount {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  designYear!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: String, default: '' })
  ifscCode!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  bankDetails!: Record<string, unknown>;

  @Prop({ type: String, default: '', select: false })
  accountNumberEncrypted!: string;

  @Prop({ type: String, default: '', select: false })
  accountNumberHash!: string;

  @Prop({ type: String, default: '' })
  accountNumberMasked!: string;

  @Prop({ type: String, default: '' })
  accountNumberLast4!: string;

  @Prop({
    type: XviFcBankAccountProofFileSchema,
    required: true,
  })
  proofFile!: XviFcBankAccountProofFile;

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
    ],
    default: FORM_STATUS.NOT_STARTED,
  })
  currentFormStatus!: FormStatusType;

  /** Human-readable label mirroring currentFormStatus — persisted so the status is readable directly from Mongo. */
  @Prop({ type: String, default: getFormStatusLabel(FORM_STATUS.NOT_STARTED) })
  currentFormStatusLabel!: string;

  /** Current/latest STATE decision — null until a state user makes a final call. */
  @Prop({ type: DecisionInfoSchema, default: null })
  stateDecision!: DecisionInfo | null;

  /** Current/latest MoHUA decision — null until MoHUA acts on what state handed off. */
  @Prop({ type: DecisionInfoSchema, default: null })
  mohuaDecision!: DecisionInfo | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  submittedBy?: Types.ObjectId;

  @Prop({ type: Date })
  submittedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const XviFcBankAccountSchema = SchemaFactory.createForClass(XviFcBankAccount);

XviFcBankAccountSchema.index({ ulb: 1, designYear: 1 }, { unique: true });
