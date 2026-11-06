import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  ClaimLetterUlbSnapshot,
  ClaimLetterUlbSnapshotSchema,
} from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import type { ClaimLetterInstallment } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';

export type OmUlbDocument = HydratedDocument<OmUlb>;

/**
 * One ULB of a claim letter the SO verified, waiting for (or covered by) its Office Memorandum. Copied from the
 * claim letter's ULB rows when the SO approves the letter; Generate OM stamps `om`. The unique
 * `{state, year, installment, ulbId}` index is the OM lock: a ULB can sit in one OM per installment.
 */
@Schema({ collection: 'xvifc_om_ulbs', timestamps: true, versionKey: false })
export class OmUlb {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ClaimLetterBatch', required: true, immutable: true })
  claimLetter!: Types.ObjectId;

  /** The claim letter's own row for this ULB (`xvifc_claim_letter_batch_ulbs`), kept as the source record. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ClaimLetterBatchUlb', required: true, immutable: true })
  claimLetterUlb!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true, immutable: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true, immutable: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, enum: [1, 2], required: true, immutable: true })
  installment!: ClaimLetterInstallment;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true, immutable: true })
  ulbId!: Types.ObjectId;

  @Prop({ type: ClaimLetterUlbSnapshotSchema, required: true })
  ulbSnapshot!: ClaimLetterUlbSnapshot;

  /** Whole rupees, as on the claim letter. */
  @Prop({ type: Number, required: true })
  allocatedAmount!: number;

  @Prop({ type: Number, required: true })
  claimedAmount!: number;

  /** The OM that covers this ULB; null until MoHUA generates the letter's OM. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Om', default: null })
  om!: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const OmUlbSchema = SchemaFactory.createForClass(OmUlb);

OmUlbSchema.index({ state: 1, year: 1, installment: 1, ulbId: 1 }, { unique: true });
OmUlbSchema.index({ claimLetter: 1 });
OmUlbSchema.index({ om: 1 });
