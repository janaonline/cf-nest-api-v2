import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FormHistoryAction } from 'src/common/constants/form-status.constants';

export type EulbFormHistoryDocument = HydratedDocument<ElectedUrbanLocalBodiesFormHistory>;

/** Append-only log of `currentFormStatus` transitions. One row per real status change — a no-op
 *  re-save writes nothing. Only CREATE_DRAFT/FINAL_SUBMIT occur today; no MoHUA review workflow
 *  exists for EULB yet. */
@Schema({
  collection: 'xvifc_elected_ulb_form_logs',
  timestamps: true,
  versionKey: false,
})
export class ElectedUrbanLocalBodiesFormHistory {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ElectedUrbanLocalBodiesForm', required: true })
  eulbForm!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(FormHistoryAction), required: true })
  action!: FormHistoryAction;

  @Prop({ type: Number, required: true })
  fromStatus!: number;

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

  // Row-data snapshot, populated only on FINAL_SUBMIT. Excel re-upload hard-deletes the previous
  // dataset version's rows, so this is the only surviving record of what was actually submitted.
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  snapshot?: Record<string, unknown>[] | null;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

export const ElectedUrbanLocalBodiesFormHistorySchema = SchemaFactory.createForClass(
  ElectedUrbanLocalBodiesFormHistory,
);

ElectedUrbanLocalBodiesFormHistorySchema.index({ eulbForm: 1, changedAt: -1 });
ElectedUrbanLocalBodiesFormHistorySchema.index({ state: 1, year: 1, changedAt: -1 });
