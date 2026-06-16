import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { THREAD_PERMISSION } from '../../common/constants/communication.constants';

export type ThreadParticipantDocument = ThreadParticipant & Document;

@Schema({ timestamps: true, collection: 'thread_participants' })
export class ThreadParticipant {
  @Prop({ type: Types.ObjectId, ref: 'MessageThread', required: true, index: true })
  threadId!: Types.ObjectId;

  /** 'USER' for individual users, 'ROLE_GROUP' for org+role combinations */
  @Prop({ type: String, enum: ['USER', 'ROLE_GROUP'], required: true })
  participantType!: string;

  /** userId string for USER type; "orgType:orgId:roleCode" for ROLE_GROUP */
  @Prop({ type: String, required: true })
  participantId!: string;

  @Prop({ type: String })
  orgType?: string;

  @Prop({ type: Types.ObjectId })
  orgId?: Types.ObjectId;

  @Prop({ type: String })
  roleCode?: string;

  @Prop({ type: [String], enum: Object.values(THREAD_PERMISSION), default: ['READ'] })
  permissions!: string[];

  @Prop({ type: Boolean, default: true })
  canReceiveNotifications!: boolean;

  @Prop({ type: Date, default: Date.now })
  joinedAt!: Date;
}

export const ThreadParticipantSchema = SchemaFactory.createForClass(ThreadParticipant);

ThreadParticipantSchema.index({ threadId: 1, participantType: 1, participantId: 1 }, { unique: true });
ThreadParticipantSchema.index({ orgType: 1, orgId: 1, roleCode: 1 });
