import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ForumEmbeddedUser, ForumEmbeddedUserSchema } from './forum-embedded-user.schema';

export type ForumThreadDocument = HydratedDocument<ForumThread>;

@Schema({ _id: false })
export class ForumThreadCounts {
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  replies!: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  views!: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  likes!: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  bookmarks!: number;
}
const ForumThreadCountsSchema = SchemaFactory.createForClass(ForumThreadCounts);

@Schema({ collection: 'threads', versionKey: false })
export class ForumThread {
  @Prop({ type: String, required: true, trim: true, maxlength: 140 })
  title!: string;

  @Prop({ type: String, required: true, unique: true })
  slug!: string;

  @Prop({ type: String, required: true, maxlength: 20_000 })
  body!: string;

  @Prop({ type: Types.ObjectId, ref: 'ForumCategory', required: true })
  categoryId!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  categorySlug!: string;

  @Prop({ type: ForumEmbeddedUserSchema, required: true })
  user!: ForumEmbeddedUser;

  @Prop({ type: ForumThreadCountsSchema, required: true, default: () => ({}) })
  counts!: ForumThreadCounts;

  @Prop({ type: Boolean, required: true, default: true, index: true })
  isPublished!: boolean;

  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy?: Types.ObjectId | null;

  @Prop({ type: Date, required: true })
  createdAt!: Date;

  @Prop({ type: Date, required: true })
  updatedAt!: Date;

  @Prop({ type: Date, required: true, index: true })
  lastActivityAt!: Date;
}

export const ForumThreadSchema = SchemaFactory.createForClass(ForumThread);
ForumThreadSchema.index({ categorySlug: 1, lastActivityAt: -1 });
ForumThreadSchema.index({ 'user.userId': 1 });
ForumThreadSchema.index({ 'user.userAgentId': 1 });
