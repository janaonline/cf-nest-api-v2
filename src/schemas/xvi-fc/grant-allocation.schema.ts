import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GrantAllocationDocument = HydratedDocument<GrantAllocation>;

// basic/performance are expected to be whole Rupees, matching every other xvi-fc amount field. This
// collection has no write path in this repo — populated by an external process, so there's no
// DTO/validator here to enforce it. Every read site that derives totalMoHUAAllocation from
// basic+performance defensively `Math.round()`s the sum in case that external data ever slips.
@Schema({
  collection: 'grantAllocation',
  timestamps: true,
  versionKey: false,
})
export class GrantAllocation {
  @Prop({ type: Types.ObjectId, ref: 'State', required: true, index: true })
  stateId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Year', required: true, index: true })
  yearId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  basic: number;

  @Prop({ type: Number, required: true, min: 0 })
  performance: number;
}

export const GrantAllocationSchema =
  SchemaFactory.createForClass(GrantAllocation);

GrantAllocationSchema.index({ stateId: 1, yearId: 1 }, { unique: true });