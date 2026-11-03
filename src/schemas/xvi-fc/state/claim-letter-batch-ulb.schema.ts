import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  ClaimLetterEligibilitySourceSnapshot,
  ClaimLetterEligibilitySourceSnapshotSchema,
} from './claim-letter-eligibility-source-snapshot.schema';
import type { ClaimLetterBatchNumber, ClaimLetterInstallment } from './claim-letter-batch.schema';

export type ClaimLetterBatchUlbDocument = HydratedDocument<ClaimLetterBatchUlb>;

@Schema({ _id: false })
export class ClaimLetterUlbSnapshot {
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, default: null })
  censusCode!: string | null;

  @Prop({ type: String, default: null })
  sbCode!: string | null;
}

export const ClaimLetterUlbSnapshotSchema = SchemaFactory.createForClass(ClaimLetterUlbSnapshot);

/** Brain §14.4's devolutionSource — the allocation-amount data-resolution result, kept
 *  deliberately separate from the eligibility gate (plan §4). Installment 1 only in V1. */
@Schema({ _id: false })
export class ClaimLetterDevolutionSource {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  formDocumentId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  rowDocumentId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  datasetVersion!: number;

  @Prop({ type: Number, enum: [1, 2], required: true })
  installment!: ClaimLetterInstallment;

  // Whole Rupees (no decimals), matching Devolution's own storage — see ClaimLetterBatchUlb below.
  @Prop({ type: Number, required: true })
  allocatedAmount!: number;
}

export const ClaimLetterDevolutionSourceSchema = SchemaFactory.createForClass(ClaimLetterDevolutionSource);

/** Only a return is marked: an unmarked ULB counts as fine, so an "approved" mark would change nothing. */
export type ClaimLetterSoDecisionStatus = 'RETURNED';

/**
 * The SO's return mark on one ULB while the letter is under SO review (15). Nothing moves when it is set: the
 * letter's Return for correction reopens the marked ULBs' picked forms and rows, each with this remark.
 */
@Schema({ _id: false })
export class ClaimLetterSoDecision {
  @Prop({ type: String, enum: ['RETURNED'], required: true })
  status!: ClaimLetterSoDecisionStatus;

  /** The ULB's own forms to reopen (Annual Accounts, SLB, Bank Account, DUR). */
  @Prop({ type: [Number], default: [] })
  ulbFormIds!: number[];

  /** State forms whose row for this ULB is reopened (Elected Body, Devolution, FC Unspent). */
  @Prop({ type: [Number], default: [] })
  rowFormIds!: number[];

  /**
   * An "Eligible via exemption" ULB: the forms whose discretionary exemption (still under MoHUA review) the letter's
   * return rejects, with this remark. Its other pending exemptions are left alone.
   */
  @Prop({ type: [Number], default: [] })
  rejectExemptionFormIds!: number[];

  @Prop({ type: String, default: null })
  remark!: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  decidedBy!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  decidedAt!: Date;
}

export const ClaimLetterSoDecisionSchema = SchemaFactory.createForClass(ClaimLetterSoDecision);

/**
 * Immutable per-ULB claim child (brain §14.4) — one document per ULB per claim version. Never
 * reused by a later version (plan §7.6); a new version always creates fresh children. Money
 * fields are whole Rupees (no decimals), matching Devolution's own storage convention; percentage
 * is integer basis points (plan §8).
 */
@Schema({
  collection: 'xvifc_claim_letter_batch_ulbs',
  timestamps: true,
  versionKey: false,
})
export class ClaimLetterBatchUlb {
  // Immutable foreign-key style reference to xvifc_claim_letter_batches._id.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ClaimLetterBatch', required: true, immutable: true })
  claimLetter!: Types.ObjectId;

  // Denormalized immutable query fields — validated against the parent on creation (plan §7.5).
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true, immutable: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true, immutable: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, enum: [1, 2], required: true, immutable: true })
  installment!: ClaimLetterInstallment;

  @Prop({ type: Number, enum: [1, 2, 3], required: true, immutable: true })
  batchNumber!: ClaimLetterBatchNumber;

  @Prop({ type: Number, required: true, immutable: true })
  version!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulbId!: Types.ObjectId;

  @Prop({ type: ClaimLetterUlbSnapshotSchema, required: true })
  ulbSnapshot!: ClaimLetterUlbSnapshot;

  @Prop({ type: Number, required: true })
  allocatedAmount!: number;

  @Prop({ type: Number, required: true })
  claimedAmount!: number;

  @Prop({ type: Number, required: true })
  differenceAmount!: number;

  @Prop({ type: Number, required: true })
  differencePercentageBasisPoints!: number;

  @Prop({ type: ClaimLetterDevolutionSourceSchema, required: true })
  devolutionSource!: ClaimLetterDevolutionSource;

  // Stays [] in V1 — Devolution's evaluationLevel is 'FORM' (state-wide), so it lives only on
  // the parent's stateEligibilitySources (brain §14.3). Populated once a ROW-level source is
  // enabled (pure configuration, no reshape — plan §4).
  @Prop({ type: [ClaimLetterEligibilitySourceSnapshotSchema], default: [] })
  eligibilitySources!: ClaimLetterEligibilitySourceSnapshot[];

  /** The ULB's own discretionary exemption requests (`xvifc_eligibility_exemptions`) its
   *  eligibilitySources relied on. */
  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] })
  appliedExemptionIds!: Types.ObjectId[];

  /** The SO's return mark during SO review; the one field that changes after creation. null = not marked. */
  @Prop({ type: ClaimLetterSoDecisionSchema, default: null })
  soDecision?: ClaimLetterSoDecision | null;

  @Prop({ type: Number, default: 0 })
  revision!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ClaimLetterBatchUlbSchema = SchemaFactory.createForClass(ClaimLetterBatchUlb);

// A ULB can occur only once in one claim version.
ClaimLetterBatchUlbSchema.index({ claimLetter: 1, ulbId: 1 }, { unique: true });
// Single-ULB dashboard/history lookup.
ClaimLetterBatchUlbSchema.index({ ulbId: 1, year: 1, installment: 1, createdAt: -1 });
// State dashboard and bulk lookup.
ClaimLetterBatchUlbSchema.index({ state: 1, year: 1, installment: 1, ulbId: 1 });
// Paginated claim review/detail page.
ClaimLetterBatchUlbSchema.index({ claimLetter: 1, 'ulbSnapshot.name': 1 });
