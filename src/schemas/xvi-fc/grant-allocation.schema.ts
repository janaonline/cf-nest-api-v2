import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GrantAllocationDocument = HydratedDocument<GrantAllocation>;

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