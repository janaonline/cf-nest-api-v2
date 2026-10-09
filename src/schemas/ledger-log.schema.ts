import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * ---------------------------------------------------------------------------
 * `ledgerlogs` is a pre-existing, 16k+ document production collection — it is
 * the actual source of MaGC-digitized NMAM line-item data per ULB+financial
 * year (keyed by `ulb_code_year`), NOT a generic log table despite its name.
 *
 * This schema is intentionally `strict: false`: only the fields this feature
 * reads/writes are declared below. Every write MUST go through targeted
 * `updateOne`/`findOneAndUpdate` with `$set`/`$push` on dot-paths — never
 * load-then-`.save()` a full document, since large unmodeled fields
 * (`indicators`, `marketReadinessScore`, `tracker`, etc.) would otherwise be
 * silently dropped by Mongoose on a full-document write.
 *
 * `autoIndex: false` — several unique compound indexes already exist on this
 * collection server-side; redeclaring them here risks Mongoose attempting a
 * conflicting index build against a large production collection at boot.
 * ---------------------------------------------------------------------------
 */

export const XV_FC_REVIEW_STATUS = ['NOT_STARTED', 'DRAFT', 'SUBMITTED', 'LOCKED'] as const;
export type XvFcReviewStatus = (typeof XV_FC_REVIEW_STATUS)[number];

export const XV_FC_FINAL_ACTION = ['ACCEPT_NO_CHANGES', 'SUBMIT_WITH_COMMENTS'] as const;
export type XvFcFinalAction = (typeof XV_FC_FINAL_ACTION)[number];

export const XV_FC_ADMIN_DECISION_STATUS = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type XvFcAdminDecisionStatus = (typeof XV_FC_ADMIN_DECISION_STATUS)[number];

export const XV_FC_AUDIT_ACTION = ['ULB_FLAG', 'ULB_SUBMIT', 'ADMIN_ACCEPT', 'ADMIN_REJECT'] as const;
export type XvFcAuditAction = (typeof XV_FC_AUDIT_ACTION)[number];

@Schema({ _id: false })
export class XvFcFileRef {
  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: Date.now })
  uploadedAt: Date;
}
export const XvFcFileRefSchema = SchemaFactory.createForClass(XvFcFileRef);

@Schema({ _id: false })
class XvFcAdminDecision {
  @Prop({ type: String, enum: XV_FC_ADMIN_DECISION_STATUS, default: 'PENDING' })
  status: XvFcAdminDecisionStatus;

  @Prop({ default: '' })
  reason: string;

  @Prop({ type: Number, default: null })
  correctedValue: number | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;
}
export const XvFcAdminDecisionSchema = SchemaFactory.createForClass(XvFcAdminDecision);

@Schema({ _id: false })
class XvFcLineItemReview {
  @Prop({ type: Boolean, default: false })
  flagged: boolean;

  // The ULB's claimed correct figure — kept distinct from `comment` (free-text
  // remarks) so the FE can bind each to its own input instead of parsing a
  // "Correct value: X. remarks" string out of one field. Mirrors Ptax's
  // XvFcPtaxReview.metricReviews[code].proposedValue.
  @Prop({ type: Number, default: null })
  proposedValue: number | null;

  @Prop({ default: '' })
  comment: string;

  @Prop({ type: XvFcAdminDecisionSchema, default: null })
  adminDecision: XvFcAdminDecision | null;
}
export const XvFcLineItemReviewSchema = SchemaFactory.createForClass(XvFcLineItemReview);

@Schema({ _id: false })
export class XvFcDeclaration {
  @Prop({ type: XvFcFileRefSchema, required: true })
  file: XvFcFileRef;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  declaredBy: Types.ObjectId;

  @Prop({ default: Date.now })
  declaredAt: Date;
}
export const XvFcDeclarationSchema = SchemaFactory.createForClass(XvFcDeclaration);

@Schema({ _id: false })
class XvFcAuditEntry {
  @Prop({ type: String, enum: XV_FC_AUDIT_ACTION, required: true })
  action: XvFcAuditAction;

  @Prop({ type: String, default: null })
  lineItemCode: string | null;

  @Prop({ type: Number, default: null })
  previousValue: number | null;

  @Prop({ type: Number, default: null })
  newValue: number | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  performedBy: Types.ObjectId;

  @Prop({ type: String, required: true })
  performedByRole: string;

  @Prop({ default: '' })
  reason: string;

  @Prop({ default: Date.now })
  createdAt: Date;
}
export const XvFcAuditEntrySchema = SchemaFactory.createForClass(XvFcAuditEntry);

@Schema({ _id: false })
class XvFcReview {
  @Prop({ type: String, enum: XV_FC_REVIEW_STATUS, default: 'NOT_STARTED' })
  status: XvFcReviewStatus;

  @Prop({ type: Map, of: XvFcLineItemReviewSchema, default: () => new Map() })
  lineItemReviews: Map<string, XvFcLineItemReview>;

  @Prop({ type: String, enum: XV_FC_FINAL_ACTION, default: null })
  finalAction: XvFcFinalAction | null;

  @Prop({ type: XvFcDeclarationSchema, default: null })
  declaration: XvFcDeclaration | null;

  // One shared supporting document for the whole submission — not one per
  // flagged line item. Required whenever at least one item is flagged.
  @Prop({ type: XvFcFileRefSchema, default: null })
  supportingDocument: XvFcFileRef | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  draftSavedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  draftSavedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  submittedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  submittedAt: Date | null;

  @Prop({ type: [XvFcAuditEntrySchema], default: [] })
  auditTrail: XvFcAuditEntry[];
}
export const XvFcReviewSchema = SchemaFactory.createForClass(XvFcReview);

@Schema({ collection: 'ledgerlogs', strict: false, autoIndex: false })
export class LedgerLog {
  @Prop({ type: Types.ObjectId, ref: 'Ulb' })
  ulb_id: Types.ObjectId;

  @Prop({ type: String })
  ulb: string;

  @Prop({ type: String })
  ulb_code: string;

  @Prop({ type: String })
  state: string;

  @Prop({ type: String })
  state_code: string;

  // Financial year, format "YYYY-YY" — the real FY discriminator for this
  // collection (NOT `financialYear`/`design_year`, which exist but are
  // unpopulated on every sampled document).
  @Prop({ type: String })
  year: string;

  // Natural unique key, e.g. "KL002_2022-23". Already uniquely indexed
  // server-side — do not redeclare `unique`/`index` here (see autoIndex note above).
  @Prop({ type: String })
  ulb_code_year: string;

  @Prop({ type: Number })
  wards: number;

  @Prop({ type: Number })
  area: number;

  @Prop({ type: Number })
  population: number;

  @Prop({ type: String })
  audit_status: string;

  @Prop({ type: String })
  excel_url: string;

  // code -> amount (or null when no digitized value exists for that code).
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  lineItems: Record<string, number | null>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  indicators: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  marketReadinessScore: Record<string, unknown>;

  // Pre-existing, unrelated metadata-edit history — not touched by this feature.
  @Prop({ type: MongooseSchema.Types.Mixed, default: [] })
  tracker: Record<string, unknown>[];

  // Everything this feature owns lives under this single namespaced field.
  @Prop({ type: XvFcReviewSchema, default: null })
  xvFcReview: XvFcReview | null;
}

export type LedgerLogDocument = LedgerLog & Document;
export const LedgerLogSchema = SchemaFactory.createForClass(LedgerLog);
