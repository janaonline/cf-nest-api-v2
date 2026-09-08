import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { XvFcDeclaration, XvFcDeclarationSchema, XvFcFileRef, XvFcFileRefSchema } from './ledger-log.schema';

export const PTAX_REVIEW_STATUS = ['NOT_STARTED', 'DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'] as const;
export type PtaxReviewStatus = (typeof PTAX_REVIEW_STATUS)[number];

export const PTAX_FINAL_ACTION = ['ACCEPT_NO_CHANGES', 'SUBMIT_WITH_COMMENTS'] as const;
export type PtaxFinalAction = (typeof PTAX_FINAL_ACTION)[number];

export const PTAX_ADMIN_DECISION_STATUS = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type PtaxAdminDecisionStatus = (typeof PTAX_ADMIN_DECISION_STATUS)[number];

export const PTAX_HISTORY_ACTION = [
  'ULB_FLAG',
  'ULB_SUBMIT',
  'ADMIN_ACCEPT',
  'ADMIN_REJECT',
  'SUBMISSION_APPROVED',
  'SUBMISSION_REJECTED',
] as const;
export type PtaxHistoryAction = (typeof PTAX_HISTORY_ACTION)[number];

@Schema({ _id: false })
class PtaxAdminDecision {
  @Prop({ type: String, enum: PTAX_ADMIN_DECISION_STATUS, default: 'PENDING' })
  status: PtaxAdminDecisionStatus;

  @Prop({ default: '' })
  reason: string;

  @Prop({ type: Number, default: null })
  correctedValue: number | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;
}
export const PtaxAdminDecisionSchema = SchemaFactory.createForClass(PtaxAdminDecision);

@Schema({ _id: false })
class PtaxMetricReview {
  // Cached copy of propertytaxopmappers.value, seeded the first time this
  // metric is read (see PtaxReviewService.getDetail). Once cached, reads
  // never go back to the source table for this metric — this is the only
  // place the digitized figure lives for display after the first fetch.
  @Prop({ type: String, default: null })
  value: string | null;

  @Prop({ type: Boolean, default: false })
  flagged: boolean;

  // The ULB's claimed correct figure — kept distinct from `comment` (free-text
  // remarks) so the FE can bind each to its own input instead of parsing a
  // "Correct value: X. remarks" string out of one field.
  @Prop({ type: Number, default: null })
  proposedValue: number | null;

  @Prop({ default: '' })
  comment: string;

  @Prop({ type: PtaxAdminDecisionSchema, default: null })
  adminDecision: PtaxAdminDecision | null;
}
export const PtaxMetricReviewSchema = SchemaFactory.createForClass(PtaxMetricReview);

@Schema({ _id: false })
class PtaxHistoryEntry {
  @Prop({ type: String, enum: PTAX_HISTORY_ACTION, required: true })
  action: PtaxHistoryAction;

  @Prop({ type: String, default: null })
  metricCode: string | null;

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
export const PtaxHistoryEntrySchema = SchemaFactory.createForClass(PtaxHistoryEntry);

@Schema({ collection: 'xvfc_ptax_reviews', timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } })
export class XvFcPtaxReview {
  @Prop({ type: Types.ObjectId, ref: 'Ulb', required: true })
  ulb_id: Types.ObjectId;

  // Denormalized at first write (from Ulb/State) so the admin list doesn't
  // need a runtime join — mirrors the flat ulb/state fields ledgerlogs carries.
  @Prop({ type: String })
  ulbName: string;

  @Prop({ type: String })
  ulbCode: string;

  @Prop({ type: String })
  state: string;

  @Prop({ type: String })
  stateCode: string;

  // Real join key — matches propertytaxopmappers.year (an ObjectId ref, not
  // a string). `financialYear` is kept as a denormalized display string so
  // list/detail responses don't need to resolve it on every read.
  @Prop({ type: Types.ObjectId, ref: 'Year', required: true })
  year_id: Types.ObjectId;

  @Prop({ type: String, required: true })
  financialYear: string;

  @Prop({ type: String, enum: PTAX_REVIEW_STATUS, default: 'NOT_STARTED' })
  status: PtaxReviewStatus;

  @Prop({ type: Map, of: PtaxMetricReviewSchema, default: () => new Map() })
  metricReviews: Map<string, PtaxMetricReview>;

  @Prop({ type: String, enum: PTAX_FINAL_ACTION, default: null })
  finalAction: PtaxFinalAction | null;

  @Prop({ type: XvFcDeclarationSchema, default: null })
  declaration: XvFcDeclaration | null;

  @Prop({ type: XvFcFileRefSchema, default: null })
  supportingDocument: XvFcFileRef | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  submittedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  submittedAt: Date | null;

  // Incremented on every ULB submit — directly answers "how many times submitted/rejected".
  @Prop({ type: Number, default: 0 })
  submissionCount: number;

  @Prop({ type: [PtaxHistoryEntrySchema], default: [] })
  history: PtaxHistoryEntry[];
}

export type XvFcPtaxReviewDocument = XvFcPtaxReview & Document;
export const XvFcPtaxReviewSchema = SchemaFactory.createForClass(XvFcPtaxReview);

XvFcPtaxReviewSchema.index({ ulb_id: 1, year_id: 1 }, { unique: true });
