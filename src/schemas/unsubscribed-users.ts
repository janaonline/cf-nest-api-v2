import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class UnsubscribedUser extends Document {
  @Prop({ required: true, unique: true, index: true, lowercase: true, trim: true })
  email: string;

  @Prop({ default: null })
  reason?: string;

  @Prop({ default: null })
  source?: string;

  @Prop({ required: true, default: () => new Date() })
  unsubscribedAt: Date;
}

export const UnsubscribedUserSchema = SchemaFactory.createForClass(UnsubscribedUser);

UnsubscribedUserSchema.index({ email: 1 });
