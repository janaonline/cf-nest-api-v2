import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type YearDocument = HydratedDocument<Year>;

@Schema({
  collection: 'years',
  versionKey: false,
})
export class Year {
  @Prop({ required: true, trim: true, index: true })
  year: string;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const YearSchema = SchemaFactory.createForClass(Year);