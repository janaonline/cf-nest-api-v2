import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS, type FormStatusType } from 'src/common/constants/form-status.constants';
import { UserInfo, UserInfoSchema } from 'src/schemas/xvi-fc/annual-account.schema';

export type XviFcDurFormLogDocument = HydratedDocument<XviFcDurFormLog>;

export type DurFormLogAction = 'SUBMITTED' | 'APPROVED' | 'RETURNED' | 'UNDO';
export type DurFormLogActorStage = 'ULB' | 'STATE' | 'MOHUA';

/**
 * Append-only audit trail for DUR form events — one row per event (ULB submit, or a state/MoHUA
 * decision), never updated or deleted after insert. Mirrors xvi-fc-bank-account-form-log.schema.ts
 * exactly (same event/actor/status shape) — DUR's per-document (tiedGrant/untiedGrant) upload and
 * manual-review history lives on XviFcDur.documents[] itself, not here; this collection only
 * records the whole-form lifecycle transitions.
 */
@Schema({
  collection: 'xvifc_dur_forms_logs',
  timestamps: true,
  versionKey: false,
})
export class XviFcDurFormLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcDur', required: true })
  durId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  designYear!: Types.ObjectId;

  @Prop({ type: String, enum: ['SUBMITTED', 'APPROVED', 'RETURNED', 'UNDO'], required: true })
  action!: DurFormLogAction;

  @Prop({
    type: Number,
    enum: [
      FORM_STATUS.NOT_STARTED,
      FORM_STATUS.IN_PROGRESS,
      FORM_STATUS.UNDER_REVIEW_BY_STATE,
      FORM_STATUS.RETURNED_BY_STATE,
      FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      FORM_STATUS.RETURNED_BY_MOHUA,
      FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
      FORM_STATUS.APPROVED_BY_STATE,
      FORM_STATUS.UNDO,
    ],
    required: true,
  })
  toStatus!: FormStatusType;

  /** Human-readable label mirroring toStatus — persisted so the history is readable directly from Mongo. */
  @Prop({ type: String, required: true })
  toStatusLabel!: string;

  @Prop({ type: String, enum: ['ULB', 'STATE', 'MOHUA'], required: true })
  actorStage!: DurFormLogActorStage;

  @Prop({ type: UserInfoSchema, required: true })
  userInfo!: UserInfo;

  /** The decision note — visible to the ULB. Omitted (not stored as null) when there's no note. */
  @Prop({ type: String })
  note?: string;

  /** Correlates every row written by one bulk-decide request. Omitted outside bulk actions. */
  @Prop({ type: String })
  batchId?: string;
}

export const XviFcDurFormLogSchema = SchemaFactory.createForClass(XviFcDurFormLog);

XviFcDurFormLogSchema.index({ durId: 1, createdAt: -1 });
XviFcDurFormLogSchema.index({ ulb: 1, designYear: 1, createdAt: -1 });
XviFcDurFormLogSchema.index({ batchId: 1 }, { sparse: true });
