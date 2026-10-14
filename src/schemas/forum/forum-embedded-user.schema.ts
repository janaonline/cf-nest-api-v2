import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/** Author snapshot embedded in a thread/comment, plus bounded audit metadata that is never serialized publicly. */
@Schema({ _id: false })
export class ForumEmbeddedUser {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 60 })
  name!: string;

  @Prop({ type: String, required: true, default: 'USER' })
  role!: string;

  @Prop({ type: String, default: null, maxlength: 64 })
  ipAddress?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'ForumUserAgent', default: null })
  userAgentId?: Types.ObjectId | null;
}

export const ForumEmbeddedUserSchema = SchemaFactory.createForClass(ForumEmbeddedUser);
