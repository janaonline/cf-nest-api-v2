import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ROW_STATUS, RowStatusType } from 'src/common/constants/row-status.constants';

export type XviFcUnspentStateFormRowDocument = HydratedDocument<XviFcUnspentStateFormRow>;

/**
 * Preserves the exact Devolution Formula source used to compute a row's `allocationAmount`,
 * so a later Devolution rejection/reconciliation can identify affected rows by exact reference
 * rather than only by state/year (business brain §10.10).
 */
@Schema({ _id: false })
export class FcUnspentAllocationSource {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'DevolutionFormulaForm', required: true })
  devolutionFormId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'DevolutionFormulaRow', required: true })
  devolutionRowId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  datasetVersion!: number;

  @Prop({ type: Number, enum: [1, 2], required: true })
  installment!: 1 | 2;

  @Prop({ type: Number, required: true })
  allocationAmount!: number;
}

export const FcUnspentAllocationSourceSchema = SchemaFactory.createForClass(FcUnspentAllocationSource);

/**
 * Reusable "row content" shape — the ULB/allocation/eligibility fields shared by the
 * live row document and every snapshot that embeds a point-in-time copy of it
 * (row-history's `snapshot`, parent-history's `unspentUlbData[]`). Defined once here
 * to avoid duplicating the same field list across three schemas.
 */
@Schema({ _id: false })
export class FcUnspentUlbRowSnapshot {
  @Prop({ type: Number, required: true })
  rowNumber!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulbId!: Types.ObjectId;

  @Prop({ type: String, default: '' })
  censusCode!: string;

  @Prop({ type: String, default: '' })
  sbCode!: string;

  @Prop({ type: String, required: true })
  ulbName!: string;

  @Prop({ type: Number, required: true })
  allocationAmount!: number;

  @Prop({ type: Number, required: true })
  unspentAmount!: number;

  @Prop({ type: Number, required: true })
  allocationPerc!: number;

  @Prop({ type: Boolean, required: true })
  eligibility!: boolean;

  @Prop({ type: String, enum: [...Object.values(ROW_STATUS), null], default: null })
  rowStatus!: RowStatusType | null;

  @Prop({ type: String, default: null })
  rejectionRemark!: string | null;

  @Prop({ type: FcUnspentAllocationSourceSchema, default: null })
  allocationSource!: FcUnspentAllocationSource | null;
}

export const FcUnspentUlbRowSnapshotSchema = SchemaFactory.createForClass(FcUnspentUlbRowSnapshot);

/**
 * One current row per (form, ulbId) — upserted, never hard-deleted. `isActive`
 * tracks current dataset membership (omitted-from-latest-draft/submit -> false,
 * re-added -> true again). `rowStatus` tracks the separate MoHUA-review workflow
 * (null pre-submission, ROW_STATUS.UPDATE_PENDING after a state final submit);
 * toggling `isActive` never implies a `rowStatus` change.
 */
@Schema({
  collection: 'xvi_fc_unspent_state_form_rows',
  timestamps: true,
  versionKey: false,
})
export class XviFcUnspentStateFormRow {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcUnspentStateForm', required: true })
  form!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  rowNumber!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulbId!: Types.ObjectId;

  @Prop({ type: String, default: '' })
  censusCode!: string;

  @Prop({ type: String, default: '' })
  sbCode!: string;

  @Prop({ type: String, required: true })
  ulbName!: string;

  @Prop({ type: Number, required: true })
  allocationAmount!: number;

  @Prop({ type: Number, required: true })
  unspentAmount!: number;

  @Prop({ type: Number, required: true })
  allocationPerc!: number;

  @Prop({ type: Boolean, required: true })
  eligibility!: boolean;

  @Prop({ type: String, enum: [...Object.values(ROW_STATUS), null], default: null })
  rowStatus!: RowStatusType | null;

  /**
   * MoHUA's reason for rejecting this row. Required (non-empty, trimmed) whenever a
   * row transitions to `ROW_STATUS.REJECTED`; cleared on approval. A future State-side
   * row-correction phase will clear it again on resubmission — not implemented yet.
   */
  @Prop({ type: String, default: null })
  rejectionRemark!: string | null;

  @Prop({ type: FcUnspentAllocationSourceSchema, default: null })
  allocationSource!: FcUnspentAllocationSource | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const XviFcUnspentStateFormRowSchema = SchemaFactory.createForClass(XviFcUnspentStateFormRow);

// One row per ULB per form — upsert target for reactivate/deactivate.
XviFcUnspentStateFormRowSchema.index({ form: 1, ulbId: 1 }, { unique: true });
XviFcUnspentStateFormRowSchema.index({ form: 1, rowNumber: 1 });
XviFcUnspentStateFormRowSchema.index({ form: 1, rowStatus: 1, rowNumber: 1 });
XviFcUnspentStateFormRowSchema.index({ state: 1, year: 1, ulbId: 1, isActive: 1 });
// Supports MoHUA row review: scoped-to-form, active-only, filtered/sorted by review status.
XviFcUnspentStateFormRowSchema.index({ form: 1, isActive: 1, rowStatus: 1, rowNumber: 1 });
