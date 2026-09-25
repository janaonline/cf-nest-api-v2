import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FileInfo, FileInfoSchema } from 'src/schemas/common/file.schema';
import { ApplicableFc } from './fc-unspent-state-form.schema';
import { FcUnspentUlbRowSnapshot, FcUnspentUlbRowSnapshotSchema } from './fc-unspent-state-form-row.schema';

export type XviFcUnspentStateFormHistoryDocument = HydratedDocument<XviFcUnspentStateFormHistory>;

/**
 * Immutable snapshot of a final-submit transition. Written only on final submit
 * (no draft history) — there is exactly one implicit action, so unlike SFC Status's
 * history there is no `action` field.
 */
@Schema({
  collection: 'xvifc_unspent_state_form_logs',
  timestamps: true,
  versionKey: false,
})
export class XviFcUnspentStateFormHistory {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcUnspentStateForm', required: true })
  fcUnspentForm!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  fromStatus!: number;

  @Prop({ type: Number, required: true })
  toStatus!: number;

  @Prop({ type: Number, required: true })
  auditRevision!: number;

  @Prop({ type: String, enum: ['14TH_FC', '15TH_FC'], default: null })
  applicableFc?: ApplicableFc | null;

  @Prop({ type: Boolean, default: null })
  isFcUnspent!: boolean | null;

  @Prop({ type: FileInfoSchema, default: null })
  fcDeclaration!: FileInfo | null;

  @Prop({ type: FileInfoSchema, default: null })
  fcUnspentDeclaration!: FileInfo | null;

  @Prop({ type: [FcUnspentUlbRowSnapshotSchema], default: [] })
  unspentUlbData!: FcUnspentUlbRowSnapshot[];

  @Prop({ type: Boolean, default: false })
  checkboxConfirmation!: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  changedBy!: Types.ObjectId;

  @Prop({ type: Date, default: () => new Date() })
  changedAt!: Date;

  @Prop({ type: String })
  ip?: string;

  @Prop({ type: String })
  userAgent?: string;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;
}

export const XviFcUnspentStateFormHistorySchema = SchemaFactory.createForClass(XviFcUnspentStateFormHistory);

XviFcUnspentStateFormHistorySchema.index({ fcUnspentForm: 1, changedAt: -1 });
XviFcUnspentStateFormHistorySchema.index({ state: 1, year: 1, changedAt: -1 });
