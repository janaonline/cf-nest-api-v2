import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class EmailList extends Document {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address.'],
  })
  email: string;

  @Prop({ default: null })
  unsubscribedAt: Date;

  @Prop({ default: false })
  isUnsubscribed: boolean;

  @Prop({ default: null })
  verifiedAt: Date;

  @Prop({ default: false })
  isVerified: boolean;

  @Prop({ required: true, default: 1 })
  attempt?: number;
}

export type EmailListDocument = EmailList & Document;
export const EmailListSchema = SchemaFactory.createForClass(EmailList);

EmailListSchema.index({ email: 1 });
