import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS, type FormStatusType } from 'src/common/constants/form-status.constants';

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
  collection: 'xvi_fc_bank_accounts',
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
      FORM_STATUS.RETURNED_BY_MOHUA,
    ],
    default: FORM_STATUS.NOT_STARTED,
  })
  currentFormStatus!: FormStatusType;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  submittedBy?: Types.ObjectId;

  @Prop({ type: Date })
  submittedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const XviFcBankAccountSchema = SchemaFactory.createForClass(XviFcBankAccount);

XviFcBankAccountSchema.index({ ulb: 1, designYear: 1 }, { unique: true });
