import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type StateDocument = HydratedDocument<State>;

@Schema({
  collection: 'states',
  versionKey: false,
})
export class State {
  @Prop({ required: true, trim: true, index: true })
  name: string;

  @Prop({ default: true })
  isActive?: boolean;

  @Prop()
  code?: string;

  @Prop()
  regionalName?: string;

  @Prop()
  slug?: string;
}

export const StateSchema = SchemaFactory.createForClass(State);