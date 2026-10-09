import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { GTC_INSTALLMENTS, type GtcInstallment } from 'src/module/xvi-fc/state/gtc/constants/gtc.constants';

export type XviFcGtcDocument = HydratedDocument<XviFcGtc>;

/** Form-level, no rows — one document per (state, year, installment). See gtc/CLAUDE.md's "Why
 *  form-level + installment is a new combination" section for the full rationale. */
@Schema({
  collection: 'xvifc_gtc',
  timestamps: true,
  versionKey: false,
})
export class XviFcGtc {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, enum: GTC_INSTALLMENTS, required: true })
  installment!: GtcInstallment;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  data!: Record<string, unknown>;

  @Prop({ type: Number, default: FORM_STATUS.NOT_STARTED })
  currentFormStatus!: number;

  @Prop({ type: String, default: null })
  pmuRemarks?: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  submittedBy?: Types.ObjectId;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted?: boolean;

  // Injected by Mongoose timestamps: true - declared here for TypeScript visibility only.
  createdAt?: Date;
  updatedAt?: Date;
}

export const XviFcGtcSchema = SchemaFactory.createForClass(XviFcGtc);

XviFcGtcSchema.index({ state: 1, year: 1, installment: 1 }, { unique: true });
