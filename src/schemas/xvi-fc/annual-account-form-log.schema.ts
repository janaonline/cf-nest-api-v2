import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { AnnualAccountFormStatus, UserInfo, UserInfoSchema } from './annual-account.schema';

export type XviFcAnnualAccountFormLogDocument = HydratedDocument<XviFcAnnualAccountFormLog>;

export type FormLogAction = 'SUBMITTED' | 'APPROVED' | 'RETURNED';
export type FormLogActorStage = 'ULB' | 'STATE' | 'MOHUA';

/** One document's outcome within a single log event — mirrors DocumentItem, not a full copy of it. */
@Schema({ _id: false, versionKey: false })
export class FormLogDocumentEntry {
  @Prop({ required: true })
  docId!: string;

  @Prop({ type: String, enum: ['APPROVED', 'RETURNED'], default: null })
  decision!: 'APPROVED' | 'RETURNED' | null;

  @Prop({ type: String, default: null })
  comment!: string | null;

  /** S3 object key of the file this decision was made against, so the audit trail can point at the exact upload. */
  @Prop({ type: String, default: null })
  filePath!: string | null;
}

export const FormLogDocumentEntrySchema = SchemaFactory.createForClass(FormLogDocumentEntry);

/**
 * Append-only audit trail for annual account section decisions — one row per event
 * (ULB submit, or a state/MOHUA final decision), never updated or deleted after insert.
 * Deliberately lean: full per-document decision history already lives on
 * XviFcAnnualAccount.<section>.documents[].stateDecision; this collection exists for
 * cross-ULB / system-wide queries (recent activity, bulk-action correlation, reporting)
 * that shouldn't require scanning every ULB's document individually.
 */
@Schema({
  collection: 'xvifc_annualaccount_datas_form_logs',
  timestamps: true,
  versionKey: false,
})
export class XviFcAnnualAccountFormLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcAnnualAccount', required: true })
  annualAccountId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  designYear!: Types.ObjectId;

  @Prop({ type: String, enum: ['auditedData', 'unauditedData'], required: true })
  section!: 'auditedData' | 'unauditedData';

  @Prop({ required: true })
  formId!: number;

  @Prop({ type: String, enum: ['SUBMITTED', 'APPROVED', 'RETURNED'], required: true })
  action!: FormLogAction;

  @Prop({ type: String, enum: Object.values(AnnualAccountFormStatus), required: true })
  toStatus!: AnnualAccountFormStatus;

  @Prop({ type: String, enum: ['ULB', 'STATE', 'MOHUA'], required: true })
  actorStage!: FormLogActorStage;

  @Prop({ type: UserInfoSchema, required: true })
  userInfo!: UserInfo;

  /** The "Review Note on this form" — visible to the ULB. Null for a plain SUBMITTED event. */
  @Prop({ type: String, default: null })
  note!: string | null;

  /** Correlates every row written by one bulk-decide request. Null outside bulk actions. */
  @Prop({ type: String, default: null })
  batchId!: string | null;

  @Prop({ type: [FormLogDocumentEntrySchema], default: [] })
  documents!: FormLogDocumentEntry[];
}

export const XviFcAnnualAccountFormLogSchema = SchemaFactory.createForClass(XviFcAnnualAccountFormLog);

XviFcAnnualAccountFormLogSchema.index({ annualAccountId: 1, section: 1, createdAt: -1 });
XviFcAnnualAccountFormLogSchema.index({ ulb: 1, designYear: 1, createdAt: -1 });
XviFcAnnualAccountFormLogSchema.index({ batchId: 1 }, { sparse: true });
