import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { RowStatusType } from 'src/common/constants/row-status.constants';
import { FcUnspentUlbRowSnapshot, FcUnspentUlbRowSnapshotSchema } from './fc-unspent-state-form-row.schema';

export type XviFcUnspentStateFormRowHistoryDocument = HydratedDocument<XviFcUnspentStateFormRowHistory>;

/**
 * Immutable, append-only row-status transition log. Inserted only when a row's
 * `rowStatus` actually changes (e.g. null -> UPDATE_PENDING on first final submit);
 * a resubmission that leaves `rowStatus` unchanged writes no entry. No `action`
 * field — the event is derived from `previousStatus -> currentStatus`. No
 * update/delete operations are exposed by the row-history service.
 */
@Schema({
  collection: 'xvi_fc_unspent_state_form_row_histories',
  timestamps: true,
  versionKey: false,
})
export class XviFcUnspentStateFormRowHistory {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcUnspentStateFormRow', required: true })
  row!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcUnspentStateForm', required: true })
  form!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: String, default: null })
  previousStatus!: RowStatusType | null;

  @Prop({ type: String, required: true })
  currentStatus!: RowStatusType;

  @Prop({ type: FcUnspentUlbRowSnapshotSchema, required: true })
  snapshot!: FcUnspentUlbRowSnapshot;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;

  @Prop({ type: String, default: null })
  ipAddress?: string | null;

  @Prop({ type: String, default: null })
  userAgent?: string | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const XviFcUnspentStateFormRowHistorySchema = SchemaFactory.createForClass(XviFcUnspentStateFormRowHistory);

XviFcUnspentStateFormRowHistorySchema.index({ row: 1, createdAt: -1 });
XviFcUnspentStateFormRowHistorySchema.index({ form: 1, currentStatus: 1, createdAt: -1 });
XviFcUnspentStateFormRowHistorySchema.index({ state: 1, year: 1, createdAt: -1 });
