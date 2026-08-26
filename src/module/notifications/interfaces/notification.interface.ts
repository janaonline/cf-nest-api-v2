import { Types } from 'mongoose';

/** Plain-object shape returned by .lean() queries on notifications. */
export interface INotification {
  _id: Types.ObjectId;
  recipientUserId: Types.ObjectId;
  type: string;
  title: string;
  message: string;
  contextType?: string;
  contextId?: Types.ObjectId;
  threadId?: Types.ObjectId;
  financialYear?: string;
  redirectUrl: string;
  isRead: boolean;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
