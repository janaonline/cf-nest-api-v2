import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ForumBookmarkDocument = HydratedDocument<ForumBookmark>;

@Schema({ collection: 'bookmarks', versionKey: false })
export class ForumBookmark {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ForumThread', required: true, index: true })
  threadId!: Types.ObjectId;

  @Prop({ type: Date, required: true, default: Date.now })
  createdAt!: Date;
}

export const ForumBookmarkSchema = SchemaFactory.createForClass(ForumBookmark);
ForumBookmarkSchema.index({ userId: 1, threadId: 1 }, { unique: true });
