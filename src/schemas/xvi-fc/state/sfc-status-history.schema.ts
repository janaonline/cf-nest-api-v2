import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SfcStatusAction } from './sfc-status.schema';

export type XviFcSfcStatusHistoryDocument = HydratedDocument<XviFcSfcStatusHistory>;

@Schema({
  collection: 'xvifc_sfc_histories',
  timestamps: true,
  versionKey: false,
})
export class XviFcSfcStatusHistory {
  /** Reference to the parent SFC Status form document */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcSfcStatus', required: true })
  sfcStatusForm!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(SfcStatusAction), required: true })
  action!: SfcStatusAction;

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

export const XviFcSfcStatusHistorySchema = SchemaFactory.createForClass(XviFcSfcStatusHistory);

XviFcSfcStatusHistorySchema.index({ sfcStatusForm: 1, changedAt: -1 });
XviFcSfcStatusHistorySchema.index({ state: 1, year: 1, changedAt: -1 });
