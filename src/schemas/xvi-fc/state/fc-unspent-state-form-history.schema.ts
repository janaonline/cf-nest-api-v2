import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ApplicableFc } from './fc-unspent-state-form.schema';
import { FcUnspentUlbRowSnapshot, FcUnspentUlbRowSnapshotSchema } from './fc-unspent-state-form-row.schema';

export type XviFcUnspentStateFormHistoryDocument = HydratedDocument<XviFcUnspentStateFormHistory>;

/**
 * Immutable snapshot of a status transition — written on both `saveDraft` and `finalSubmit`, each
 * producing a distinguishable shape rather than a separate `action` field (unlike SFC Status's
 * history): a `saveDraft` entry is deliberately bare (only `fromStatus`/`toStatus`/`auditRevision`/
 * `changedBy`/`ip`/`userAgent` set, everything else left to its schema default), while a
 * `finalSubmit` entry always fully populates `data`/`snapshot` too. `data` holds the form-level
 * fields (`isFcUnspent`/`fcDeclaration`/`fcUnspentDeclaration`/`checkboxConfirmation`) as one object,
 * consistent with every other xvi-fc form's history schema; `snapshot` holds the row array (renamed
 * from `unspentUlbData` for the same cross-form consistency — same always-an-array semantics).
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

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  data?: Record<string, unknown> | null;

  // Renamed from `unspentUlbData` for cross-form consistency ("if row-level data is stored in the
  // main formlog, use snapshot as the key") — pure rename, same always-an-array (never null)
  // semantics.
  @Prop({ type: [FcUnspentUlbRowSnapshotSchema], default: [] })
  snapshot!: FcUnspentUlbRowSnapshot[];

  @Prop({ type: String })
  remarks?: string;

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
