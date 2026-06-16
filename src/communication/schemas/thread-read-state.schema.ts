import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ThreadReadStateDocument = ThreadReadState & Document;

@Schema({ timestamps: true, collection: 'thread_read_states' })
export class ThreadReadState {
  @Prop({ type: Types.ObjectId, ref: 'MessageThread', required: true, index: true })
  threadId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Date })
  lastReadAt?: Date;

  @Prop({ type: Number, default: 0 })
  unreadCount!: number;
}

export const ThreadReadStateSchema = SchemaFactory.createForClass(ThreadReadState);

ThreadReadStateSchema.index({ threadId: 1, userId: 1 }, { unique: true });
