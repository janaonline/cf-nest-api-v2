import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FileInfo, FileInfoSchema } from 'src/schemas/common/file.schema';
import { UserInfo, UserInfoSchema } from 'src/schemas/xvi-fc/annual-account.schema';

export type XviFcEligibilityExemptionFormLogDocument = HydratedDocument<XviFcEligibilityExemptionFormLog>;

export type EligibilityExemptionFormLogAction = 'SUBMITTED' | 'APPROVED' | 'RETURNED';
export type EligibilityExemptionFormLogActorStage = 'STATE' | 'MOHUA';

/**
 * Append-only audit trail for Request Exemption events — one row per real transition (STATE
 * submits a `formId`, or MoHUA later approves/returns it), never updated or deleted after insert.
 * Mirrors `xvi-fc-bank-account-form-log.schema.ts`'s shape, but — like Devolution Formula/EULB's
 * form-history collections, not Bank Account's lighter one — carries a `snapshot` of what was
 * actually submitted: once a rejected entry in `XviFcEligibilityExemption.data[]` gets
 * wholesale-replaced by a fresh attempt, this log is the *only* remaining record of what the
 * rejected attempt actually contained (see that schema's own doc-comment). `APPROVED`/`RETURNED`
 * rows, and any code that reads this collection back (a `getFormLogs`-style endpoint, a
 * `ulb-submissions` "View History" panel), aren't built yet — this only writes on `SUBMITTED` for
 * now; logging from day one means that can be added later without a backfill.
 */
@Schema({
  collection: 'xvifc_eligibility_exemption_form_logs',
  timestamps: true,
  versionKey: false,
})
export class XviFcEligibilityExemptionFormLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcEligibilityExemption', required: true })
  requestId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  formId!: number;

  @Prop({ type: String, enum: ['SUBMITTED', 'APPROVED', 'RETURNED'], required: true })
  action!: EligibilityExemptionFormLogAction;

  @Prop({ type: Number, required: true })
  toStatus!: number;

  /** Human-readable label mirroring toStatus — persisted so the history is readable directly from Mongo. */
  @Prop({ type: String, required: true })
  toStatusLabel!: string;

  @Prop({ type: String, enum: ['STATE', 'MOHUA'], required: true })
  actorStage!: EligibilityExemptionFormLogActorStage;

  @Prop({ type: UserInfoSchema, required: true })
  userInfo!: UserInfo;

  /** What was actually submitted, captured on the SUBMITTED row — see this schema's own class
   *  doc-comment for why this (not a bare action/timestamp trail) is needed here. */
  @Prop({ type: { supportingDetails: String, supportingFile: FileInfoSchema } })
  snapshot?: { supportingDetails: string; supportingFile: FileInfo | null };

  /** Present on RETURNED rows, once MoHUA-decide exists. */
  @Prop({ type: String })
  mohuaRemarks?: string;
}

export const XviFcEligibilityExemptionFormLogSchema = SchemaFactory.createForClass(XviFcEligibilityExemptionFormLog);

XviFcEligibilityExemptionFormLogSchema.index({ requestId: 1, formId: 1, createdAt: -1 });
XviFcEligibilityExemptionFormLogSchema.index({ ulb: 1, year: 1, createdAt: -1 });
