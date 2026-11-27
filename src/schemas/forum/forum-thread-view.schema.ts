import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ForumThreadViewDocument = HydratedDocument<ForumThreadView>;

/** One row per (thread, user); the unique index is what makes the displayed view count per-user. */
@Schema({ collection: 'thread_views', versionKey: false })
export class ForumThreadView {
  @Prop({ type: Types.ObjectId, ref: 'ForumThread', required: true, index: true })
  threadId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Date, required: true, default: Date.now })
  createdAt!: Date;
}

export const ForumThreadViewSchema = SchemaFactory.createForClass(ForumThreadView);
ForumThreadViewSchema.index({ threadId: 1, userId: 1 }, { unique: true });
