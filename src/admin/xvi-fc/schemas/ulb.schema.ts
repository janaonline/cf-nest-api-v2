import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UlbDocument = HydratedDocument<Ulb>;

@Schema({
  collection: 'ulbs',
  versionKey: false,
})
export class Ulb {
  @Prop({ type: Types.ObjectId, ref: 'State', required: true, index: true })
  state: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop()
  code?: string;

  @Prop({ default: true })
  isActive?: boolean;

  @Prop()
  slug?: string;
}

export const UlbSchema = SchemaFactory.createForClass(Ulb);

UlbSchema.index({ state: 1 });