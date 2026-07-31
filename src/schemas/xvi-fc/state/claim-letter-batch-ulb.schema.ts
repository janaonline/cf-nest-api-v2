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

  // Crore-denominated, matching Devolution's own storage — see ClaimLetterBatchUlb below.
  @Prop({ type: Number, required: true })
  allocatedAmount!: number;
}

export const ClaimLetterDevolutionSourceSchema = SchemaFactory.createForClass(ClaimLetterDevolutionSource);

/**
 * Immutable per-ULB claim child (brain §14.4) — one document per ULB per claim version. Never
 * reused by a later version (plan §7.6); a new version always creates fresh children. Money
 * fields are Crore-denominated decimal floats, matching Devolution's own storage convention;
 * percentage is integer basis points (plan §8).
 */
@Schema({
  collection: 'xvi_fc_claim_letter_batch_ulbs',
  timestamps: true,
  versionKey: false,
})
export class ClaimLetterBatchUlb {
  // Immutable foreign-key style reference to xvi_fc_claim_letter_batches._id.
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

  // Always [] in V1 — eligibility exemptions are a separate parked feature (plan Context).
  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] })
  appliedExemptionIds!: Types.ObjectId[];

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
