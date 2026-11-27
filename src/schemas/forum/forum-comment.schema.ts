import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ForumEmbeddedUser, ForumEmbeddedUserSchema } from './forum-embedded-user.schema';

export type ForumCommentDocument = HydratedDocument<ForumComment>;

@Schema({ _id: false })
export class ForumCommentCounts {
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  likes!: number;
}
const ForumCommentCountsSchema = SchemaFactory.createForClass(ForumCommentCounts);

@Schema({ collection: 'comments', versionKey: false })
export class ForumComment {
  @Prop({ type: Types.ObjectId, ref: 'ForumThread', required: true })
  threadId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ForumComment', default: undefined })
  parentId?: Types.ObjectId;

  @Prop({ type: String, required: true, maxlength: 10_000 })
  body!: string;

  @Prop({ type: ForumEmbeddedUserSchema, required: true })
  user!: ForumEmbeddedUser;

  @Prop({ type: ForumCommentCountsSchema, required: true, default: () => ({}) })
  counts!: ForumCommentCounts;

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy?: Types.ObjectId | null;

  @Prop({ type: Date, required: true })
  createdAt!: Date;

  @Prop({ type: Date, required: true })
  updatedAt!: Date;
}

export const ForumCommentSchema = SchemaFactory.createForClass(ForumComment);
ForumCommentSchema.index({ threadId: 1, createdAt: 1 });
ForumCommentSchema.index({ parentId: 1, createdAt: 1 });
ForumCommentSchema.index({ 'user.userId': 1 });
ForumCommentSchema.index({ 'user.userAgentId': 1 });
