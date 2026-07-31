import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { AnnualAccountFormStatus, UserInfo, UserInfoSchema } from './annual-account.schema';

export type XviFcAnnualAccountFormLogDocument = HydratedDocument<XviFcAnnualAccountFormLog>;

export type FormLogAction = 'SUBMITTED' | 'APPROVED' | 'RETURNED' | 'UNDO';
export type FormLogActorStage = 'ULB' | 'STATE' | 'MOHUA';

/**
 * One document's outcome within a single log event — mirrors DocumentItem, not a full copy of it.
 * decision/comment/filePath are omitted entirely (not stored as null) when no decision exists yet
 * for this document at this event — e.g. every document on a plain SUBMITTED event.
 */
@Schema({ _id: false, versionKey: false })
export class FormLogDocumentEntry {
  @Prop({ required: true })
  docId!: string;

  @Prop({ type: String, enum: ['APPROVED', 'RETURNED'] })
  decision?: 'APPROVED' | 'RETURNED';

  @Prop({ type: String })
  comment?: string;

  /** S3 object key of the file this decision was made against, so the audit trail can point at the exact upload. */
  @Prop({ type: String })
  filePath?: string;
}

export const FormLogDocumentEntrySchema = SchemaFactory.createForClass(FormLogDocumentEntry);

/** Builds a FormLogDocumentEntry, omitting decision/comment/filePath rather than storing them as null. */
export function buildFormLogDocumentEntry(
  docId: string,
  decision: 'APPROVED' | 'RETURNED' | null,
  comment: string | null,
  filePath: string | null = null,
): FormLogDocumentEntry {
  return {
    docId,
    ...(decision !== null && { decision }),
    ...(comment !== null && { comment }),
    ...(filePath !== null && { filePath }),
  };
}

/**
 * Append-only audit trail for annual account section decisions — one row per event
 * (ULB submit, or a state/MOHUA final decision), never updated or deleted after insert.
 * Deliberately lean: full per-document decision history already lives on
 * XviFcAnnualAccount.<section>.documents[].stateDecision; this collection exists for
 * cross-ULB / system-wide queries (recent activity, bulk-action correlation, reporting)
 * that shouldn't require scanning every ULB's document individually.
 */
@Schema({
  collection: 'xvifc_annualaccount_form_logs',
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

  @Prop({ type: String, enum: ['SUBMITTED', 'APPROVED', 'RETURNED', 'UNDO'], required: true })
  action!: FormLogAction;

  @Prop({ type: String, enum: Object.values(AnnualAccountFormStatus), required: true })
  toStatus!: AnnualAccountFormStatus;

  @Prop({ type: String, enum: ['ULB', 'STATE', 'MOHUA'], required: true })
  actorStage!: FormLogActorStage;

  @Prop({ type: UserInfoSchema, required: true })
  userInfo!: UserInfo;

  /** The "Review Note on this form" — visible to the ULB. Omitted (not stored as null) when there's no note. */
  @Prop({ type: String })
  note?: string;

  /** Correlates every row written by one bulk-decide request. Omitted outside bulk actions. */
  @Prop({ type: String })
  batchId?: string;

  /**
   * Per-document breakdown — only meaningful for a STATE RETURNED event, where documents can
   * genuinely end up with different outcomes (some still individually approved, others returned).
   * Every other event type (SUBMITTED, STATE APPROVED, either MOHUA outcome) omits this entirely:
   * SUBMITTED has no decisions yet; STATE APPROVED always ends with every document APPROVED
   * (enforced by decideSection's stillReturned guard) so the breakdown adds nothing beyond
   * `action`; MOHUA has no per-document decision layer at all.
   */
  @Prop({ type: [FormLogDocumentEntrySchema] })
  documents?: FormLogDocumentEntry[];
}

export const XviFcAnnualAccountFormLogSchema = SchemaFactory.createForClass(XviFcAnnualAccountFormLog);

XviFcAnnualAccountFormLogSchema.index({ annualAccountId: 1, section: 1, createdAt: -1 });
XviFcAnnualAccountFormLogSchema.index({ ulb: 1, designYear: 1, createdAt: -1 });
XviFcAnnualAccountFormLogSchema.index({ batchId: 1 }, { sparse: true });
