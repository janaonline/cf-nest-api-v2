import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { UserInfo, UserInfoSchema } from './annual-account.schema';

export type XviFcManualReviewRequestDocument = HydratedDocument<XviFcManualReviewRequest>;

export type ManualReviewRequestStatus = 'PENDING' | 'APPROVED' | 'RETURNED';

/** How long a ULB is told to expect a decision within — see MANUAL_REVIEW_SLA_HOURS in
 *  annual_accounts.service.ts, the single place this duration is applied. */
export const MANUAL_REVIEW_SLA_HOURS = 48;

/**
 * Append-only history of ULB manual-review requests for xvi-fc annual-account documents whose
 * OCR validation failed, and the ADMIN decision on each — one row per request (a document
 * returned and re-flagged gets a fresh row, not an update), so turnaround/SLA/reviewer-workload
 * analytics can be computed straight from this collection without reconstructing history from a
 * mutable "current state" field.
 *
 * This is the durable audit/analytics layer only. The live gating state ULB uploads/retries are
 * checked against (`ocrInfo.isManualReviewRequested`, `manualReviewRequestedAt`,
 * `documents[].manualReviewDecision`) stays on `XviFcAnnualAccount` itself — see
 * `isAwaitingManualReviewDecision` in annual-account-status-access.util.ts — this collection
 * never needs to be read on that hot path.
 */
@Schema({
  collection: 'xvifc_ac_manual_review_requests',
  timestamps: true,
  versionKey: false,
})
export class XviFcManualReviewRequest {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcAnnualAccount', required: true })
  annualAccountId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  designYear!: Types.ObjectId;

  @Prop({ type: String, enum: ['auditedData', 'unauditedData'], required: true })
  section!: 'auditedData' | 'unauditedData';

  @Prop({ required: true })
  docId!: string;

  /** The specific uploaded file this request was about — lets a later re-upload's own request be
   *  told apart from this one even though they share the same docId. */
  @Prop({ required: true })
  uploadId!: string;

  /** The OCR job (currentUpload.ocrInfo.jobId) whose FAILED validation triggered this request —
   *  lets an analyst pull the exact OCR run behind a manual review straight from this record. */
  @Prop({ type: String, default: null })
  ocrJobId!: string | null;

  @Prop({ type: String, enum: ['PENDING', 'APPROVED', 'RETURNED'], required: true, default: 'PENDING' })
  status!: ManualReviewRequestStatus;

  @Prop({ required: true })
  requestedAt!: Date;

  @Prop({ type: UserInfoSchema, required: true })
  requestedBy!: UserInfo;

  /** requestedAt + MANUAL_REVIEW_SLA_HOURS, stamped once at request time. Breach is derived at
   *  read time as `dueAt < (decidedAt ?? now)` — never stored — so no background job is needed
   *  to keep it in sync while a request sits PENDING. */
  @Prop({ required: true })
  dueAt!: Date;

  @Prop({ type: Date, default: null })
  decidedAt!: Date | null;

  @Prop({ type: UserInfoSchema, default: null })
  decidedBy!: UserInfo | null;

  /** Shown to the ULB on a RETURNED decision; optional on APPROVED. */
  @Prop({ type: String, default: null })
  decisionNote!: string | null;
}

export const XviFcManualReviewRequestSchema = SchemaFactory.createForClass(XviFcManualReviewRequest);

XviFcManualReviewRequestSchema.index({ annualAccountId: 1, section: 1, docId: 1, requestedAt: -1 });
XviFcManualReviewRequestSchema.index({ ulb: 1, designYear: 1, requestedAt: -1 });
