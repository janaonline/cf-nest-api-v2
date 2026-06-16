import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CONTEXT_TYPE, MESSAGE_VISIBILITY } from '../../common/constants/communication.constants';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true, collection: 'messages' })
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'MessageThread', required: true, index: true })
  threadId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(CONTEXT_TYPE), required: true })
  contextType!: string;

  @Prop({ type: Types.ObjectId, required: true })
  contextId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  senderId!: Types.ObjectId;

  @Prop({ type: String })
  senderOrgType?: string;

  @Prop({ type: Types.ObjectId })
  senderOrgId?: Types.ObjectId;

  @Prop({ type: String })
  senderRoleCode?: string;

  @Prop({ type: String, default: 'TEXT' })
  messageType!: string;

  @Prop({ type: String, enum: Object.values(MESSAGE_VISIBILITY), default: MESSAGE_VISIBILITY.EXTERNAL })
  visibility!: string;

  @Prop({ type: String, required: true })
  body!: string;

  @Prop({ type: [Object], default: [] })
  attachments!: Record<string, unknown>[];

  @Prop({ type: Types.ObjectId, ref: 'Message' })
  parentMessageId?: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  isSystemGenerated!: boolean;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ threadId: 1, createdAt: 1 });
MessageSchema.index({ contextType: 1, contextId: 1 });
