import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ForumUserAgentDocument = HydratedDocument<ForumUserAgent>;

/** Deduplicated raw user-agent strings, referenced by threads/comments via `user.userAgentId`. */
@Schema({ collection: 'user_agents', versionKey: false })
export class ForumUserAgent {
  /** SHA-256 hex of `value`. */
  @Prop({ type: String, required: true, unique: true, maxlength: 64 })
  hash!: string;

  @Prop({ type: String, required: true, maxlength: 512 })
  value!: string;

  @Prop({ type: Date, required: true })
  createdAt!: Date;

  @Prop({ type: Date, required: true })
  lastSeenAt!: Date;
}

export const ForumUserAgentSchema = SchemaFactory.createForClass(ForumUserAgent);
