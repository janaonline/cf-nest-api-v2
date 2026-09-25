import { Types } from 'mongoose';

/** Plain-object shape returned by .lean() queries on thread_participants. */
export interface IThreadParticipant {
  _id: Types.ObjectId;
  threadId: Types.ObjectId;
  participantType: 'USER' | 'ROLE_GROUP';
  /** userId string for USER type; "orgType:orgId:roleCode" for ROLE_GROUP */
  participantId: string;
  orgType?: string;
  orgId?: Types.ObjectId;
  roleCode?: string;
  permissions: string[];
  canReceiveNotifications: boolean;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
