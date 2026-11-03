import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Autonomous District Council (Assam). Owns a subset of one state's ULBs: `ulbs.adc` points here and an ADC
 * user is a STATE-role user with `users.adc` set. Rows are inserted directly in the DB, not via an API.
 */
@Schema({ collection: 'adcs', timestamps: true })
export class Adc {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;
}

export type AdcDocument = Adc & Document;
export const AdcSchema = SchemaFactory.createForClass(Adc);

AdcSchema.index({ state: 1, name: 1 }, { unique: true });
