import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { UserInfo, UserInfoSchema } from './annual-account.schema';
import type { XviFcDurDocId } from './dur.schema';

export type XviFcDurManualReviewRequestDocument = HydratedDocument<XviFcDurManualReviewRequest>;

export type DurManualReviewRequestStatus = 'PENDING' | 'APPROVED' | 'RETURNED';

/**
 * Append-only history of ULB manual-review requests for DUR documents (tiedGrant/untiedGrant)
 * whose OCR validation failed, and the ADMIN decision on each. Kept as its own collection
 * (separate from XviFcManualReviewRequest, which is Annual-Account-specific) rather than a
 * generalized shared collection — lower risk for now; ADMIN checks two inboxes instead of one
 * until/unless they're unified later. Mirrors manual-review-request.schema.ts's shape exactly.
 */
@Schema({
  collection: 'xvifc_dur_manual_review_requests',
  timestamps: true,
  versionKey: false,
})
export class XviFcDurManualReviewRequest {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'XviFcDur', required: true })
  durId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  designYear!: Types.ObjectId;

  @Prop({ type: String, enum: ['tiedGrant', 'untiedGrant'], required: true })
  docId!: XviFcDurDocId;

  /** The specific uploaded file this request was about — lets a later re-upload's own request be
   *  told apart from this one even though they share the same docId. */
  @Prop({ required: true })
  uploadId!: string;

  /** The DUR-validation job (currentUpload.ocrInfo.jobId) whose FAILED validation triggered this
   *  request — lets an analyst pull the exact validation run behind a manual review directly. */
  @Prop({ type: String, default: null })
  ocrJobId!: string | null;

  @Prop({ type: String, enum: ['PENDING', 'APPROVED', 'RETURNED'], required: true, default: 'PENDING' })
  status!: DurManualReviewRequestStatus;

  @Prop({ required: true })
  requestedAt!: Date;

  @Prop({ type: UserInfoSchema, required: true })
  requestedBy!: UserInfo;

  /** requestedAt + MANUAL_REVIEW_SLA_HOURS, stamped once at request time. Breach is derived at
   *  read time as `dueAt < (decidedAt ?? now)` — never stored. */
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

export const XviFcDurManualReviewRequestSchema = SchemaFactory.createForClass(XviFcDurManualReviewRequest);

XviFcDurManualReviewRequestSchema.index({ durId: 1, docId: 1, requestedAt: -1 });
XviFcDurManualReviewRequestSchema.index({ ulb: 1, designYear: 1, requestedAt: -1 });
