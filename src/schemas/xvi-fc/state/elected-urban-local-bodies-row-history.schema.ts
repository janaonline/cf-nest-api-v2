import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ROW_REVIEW_STATUS_VALUES } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';

export type EulbRowHistoryDocument = HydratedDocument<ElectedUrbanLocalBodiesRowHistory>;

/** A row's data when `rowStatus` changed — the only surviving record once Excel re-upload
 *  hard-deletes this dataset version's rows (same rationale as the parent form history's own
 *  `snapshot` — see elected-urban-local-bodies-form-history.schema.ts). */
export interface EulbRowHistorySnapshot {
  rowNumber: number;
  ulbId: Types.ObjectId | null;
  censusCode: string | null;
  ulbName: string;
  electedBodyStatus: string | null;
  dateOfConstitution: Date | string | null;
  dateOfExpiry: Date | string | null;
  remarks: string | null;
  datasetVersion: number;
  rowStatus: RowReviewStatus | null;
  rejectionRemark: string | null;
}

@Schema({ _id: false })
class EulbRowHistorySnapshotSubdoc {
  @Prop({ type: Number, required: true }) rowNumber!: number;
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null }) ulbId!: Types.ObjectId | null;
  @Prop({ type: String, default: null }) censusCode!: string | null;
  @Prop({ type: String, default: '' }) ulbName!: string;
  @Prop({ type: String, default: null }) electedBodyStatus!: string | null;
  @Prop({ type: MongooseSchema.Types.Mixed, default: null }) dateOfConstitution!: Date | string | null;
  @Prop({ type: MongooseSchema.Types.Mixed, default: null }) dateOfExpiry!: Date | string | null;
  @Prop({ type: String, default: null }) remarks!: string | null;
  @Prop({ type: Number, required: true }) datasetVersion!: number;
  @Prop({ type: Number, enum: [...ROW_REVIEW_STATUS_VALUES, null], default: null }) rowStatus!: RowReviewStatus | null;
  @Prop({ type: String, default: null }) rejectionRemark!: string | null;
}
const EulbRowHistorySnapshotSchema = SchemaFactory.createForClass(EulbRowHistorySnapshotSubdoc);

/** Append-only row-status history for EULB PMU review — see pmu/elected-urban-local-bodies/CLAUDE.md's
 *  "Reads vs. writes relative to state/elected-urban-local-bodies" section for what gets written and why. */
@Schema({
  collection: 'xvifc_elected_ulb_row_logs',
  timestamps: true,
  versionKey: false,
})
export class ElectedUrbanLocalBodiesRowHistory {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ElectedUrbanLocalBodiesRow', required: true })
  row!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ElectedUrbanLocalBodiesForm', required: true })
  form!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, enum: [...ROW_REVIEW_STATUS_VALUES, null], default: null })
  previousStatus!: RowReviewStatus | null;

  @Prop({ type: Number, enum: ROW_REVIEW_STATUS_VALUES, required: true })
  currentStatus!: RowReviewStatus;

  @Prop({ type: EulbRowHistorySnapshotSchema, required: true })
  snapshot!: EulbRowHistorySnapshot;

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

export const ElectedUrbanLocalBodiesRowHistorySchema = SchemaFactory.createForClass(ElectedUrbanLocalBodiesRowHistory);

ElectedUrbanLocalBodiesRowHistorySchema.index({ row: 1, createdAt: -1 });
ElectedUrbanLocalBodiesRowHistorySchema.index({ form: 1, currentStatus: 1, createdAt: -1 });
ElectedUrbanLocalBodiesRowHistorySchema.index({ state: 1, year: 1, createdAt: -1 });
