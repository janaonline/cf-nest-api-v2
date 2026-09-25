import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { ClaimLetterInstallment } from './claim-letter-batch.schema';

export type ClaimLetterLockState = 'ACTIVE' | 'ACKNOWLEDGED';

export type ClaimLetterUlbLockDocument = HydratedDocument<ClaimLetterUlbLock>;

/**
 * Pure concurrency-control state (plan §7.1) — never merged with `ClaimLetterBatchUlb` (that's
 * immutable audit truth; this is fast-changing operational state). No TTL index (plan §1/§7.9):
 * an active draft may legitimately stay open a long time, and a TTL-expired lock would silently
 * let a second claim grab the same ULB. Every release path must filter by `claimLetter` and/or
 * `buildRequestId`, never by the bare `{state,year,installment,ulbId}` business key alone.
 */
@Schema({
  collection: 'xvifc_claim_letter_ulb_locks',
  timestamps: true,
  versionKey: false,
})
export class ClaimLetterUlbLock {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, enum: [1, 2], required: true })
  installment!: ClaimLetterInstallment;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulbId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ClaimLetterBatch', required: true })
  claimLetter!: Types.ObjectId;

  // Which build attempt acquired this lock — required for exact-ownership release/recovery
  // (plan §1/§7.9), never released by business key alone.
  @Prop({ type: String, required: true })
  buildRequestId!: string;

  @Prop({ type: String, enum: ['ACTIVE', 'ACKNOWLEDGED'], default: 'ACTIVE' })
  lockState!: ClaimLetterLockState;

  @Prop({ type: Date, default: () => new Date() })
  acquiredAt!: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ClaimLetterUlbLockSchema = SchemaFactory.createForClass(ClaimLetterUlbLock);

// The actual concurrency gate — a ULB can have at most one lock per State/year/installment.
ClaimLetterUlbLockSchema.index({ state: 1, year: 1, installment: 1, ulbId: 1 }, { unique: true });
// Release/ownership-scoped queries (plan §1: never release by business key alone).
ClaimLetterUlbLockSchema.index({ claimLetter: 1 });
// Stale-build recovery (plan §7.9).
ClaimLetterUlbLockSchema.index({ buildRequestId: 1 });
