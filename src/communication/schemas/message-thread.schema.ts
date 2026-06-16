import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CONTEXT_TYPE, THREAD_PURPOSE, THREAD_STATUS } from '../../common/constants/communication.constants';

export type MessageThreadDocument = MessageThread & Document;

@Schema({ timestamps: true, collection: 'message_threads' })
export class MessageThread {
  @Prop({ type: String, enum: Object.values(CONTEXT_TYPE), required: true })
  contextType!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  contextId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(THREAD_PURPOSE), required: true })
  threadPurpose!: string;

  @Prop({ type: String })
  financialYear?: string;

  @Prop({ type: Types.ObjectId, ref: 'FormTemplate' })
  formTemplateId?: Types.ObjectId;

  @Prop({ type: String })
  formCode?: string;

  @Prop({ type: String })
  formName?: string;

  @Prop({ type: Types.ObjectId })
  ulbId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  stateId?: Types.ObjectId;

  @Prop({ type: String })
  title?: string;

  @Prop({ type: String, enum: Object.values(THREAD_STATUS), default: THREAD_STATUS.OPEN })
  status!: string;

  @Prop({ type: Number })
  currentFormStatus?: number;

  @Prop({ type: Date })
  lastMessageAt?: Date;

  @Prop({ type: String })
  lastMessagePreview?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const MessageThreadSchema = SchemaFactory.createForClass(MessageThread);

MessageThreadSchema.index({ contextType: 1, contextId: 1, threadPurpose: 1 }, { unique: true });
MessageThreadSchema.index({ financialYear: 1, contextType: 1, currentFormStatus: 1 });
MessageThreadSchema.index({ ulbId: 1, financialYear: 1 });
MessageThreadSchema.index({ stateId: 1, financialYear: 1 });
MessageThreadSchema.index({ lastMessageAt: -1 });
