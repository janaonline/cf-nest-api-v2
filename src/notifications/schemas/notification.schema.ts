import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CONTEXT_TYPE } from '../../common/constants/communication.constants';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  recipientUserId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  type!: string;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, required: true })
  message!: string;

  @Prop({ type: String, enum: Object.values(CONTEXT_TYPE) })
  contextType?: string;

  @Prop({ type: Types.ObjectId })
  contextId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'MessageThread' })
  threadId?: Types.ObjectId;

  @Prop({ type: String })
  financialYear?: string;

  @Prop({ type: String })
  redirectUrl?: string;

  @Prop({ type: Boolean, default: false })
  isRead!: boolean;

  @Prop({ type: Date })
  readAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ recipientUserId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ recipientUserId: 1, contextType: 1, contextId: 1 });
