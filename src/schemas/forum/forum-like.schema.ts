import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ForumLikeDocument = HydratedDocument<ForumLike>;
export type ForumLikeTargetType = 'thread' | 'comment';

@Schema({ collection: 'likes', versionKey: false })
export class ForumLike {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: ['thread', 'comment'], required: true })
  targetType!: ForumLikeTargetType;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  targetId!: Types.ObjectId;

  @Prop({ type: Date, required: true, default: Date.now })
  createdAt!: Date;
}

export const ForumLikeSchema = SchemaFactory.createForClass(ForumLike);
ForumLikeSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true });
