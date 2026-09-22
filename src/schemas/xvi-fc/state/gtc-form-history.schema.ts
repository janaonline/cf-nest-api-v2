import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FormHistoryAction } from 'src/common/constants/form-status.constants';
import { GTC_INSTALLMENTS, type GtcInstallment } from 'src/module/xvi-fc/state/gtc/constants/gtc.constants';

export type XviFcGtcHistoryDocument = HydratedDocument<XviFcGtcHistory>;

@Schema({
  collection: 'xvifc_gtc_logs',
  timestamps: true,
  versionKey: false,
})
export class XviFcGtcHistory {
  /** Reference to the parent GTC form document */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcGtc', required: true })
  gtcForm!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, enum: GTC_INSTALLMENTS, required: true })
  installment!: GtcInstallment;

  @Prop({ type: String, enum: Object.values(FormHistoryAction), required: true })
  action!: FormHistoryAction;

  @Prop({ type: Number })
  fromStatus?: number;

  @Prop({ type: Number, required: true })
  toStatus!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  changedBy!: Types.ObjectId;

  @Prop({ type: Date, default: () => new Date() })
  changedAt!: Date;

  @Prop({ type: String })
  ip?: string;

  @Prop({ type: String })
  userAgent?: string;

  @Prop({ type: String })
  remarks?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

export const XviFcGtcHistorySchema = SchemaFactory.createForClass(XviFcGtcHistory);

XviFcGtcHistorySchema.index({ gtcForm: 1, changedAt: -1 });
XviFcGtcHistorySchema.index({ state: 1, year: 1, installment: 1, changedAt: -1 });
