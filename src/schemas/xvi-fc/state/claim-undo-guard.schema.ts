import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ClaimUndoGuardDocument = HydratedDocument<ClaimUndoGuard>;

/**
 * One document per State + year that serializes a PMU undo with a claim letter taking its ULB locks.
 * Both write it inside their own transaction (`PmuUndoEligibilityService.touchClaimUndoGuard`), so when
 * they overlap Mongo aborts one of them with a write conflict instead of letting both succeed. It holds no
 * business data; `writes` only exists to have something to change.
 */
@Schema({ collection: 'xvifc_claim_undo_guards', timestamps: true, versionKey: false })
export class ClaimUndoGuard {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: Number, default: 0 })
  writes!: number;
}

export const ClaimUndoGuardSchema = SchemaFactory.createForClass(ClaimUndoGuard);

// Unique, so two transactions creating the first guard for a State + year also conflict.
ClaimUndoGuardSchema.index({ state: 1, year: 1 }, { unique: true });
