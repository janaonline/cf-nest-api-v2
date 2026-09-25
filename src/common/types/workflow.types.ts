import { ClientSession, Types } from 'mongoose';
import { MESSAGE_VISIBILITY } from '../constants/communication.constants';

export interface INotificationAudience {
  orgType?: string;
  orgId?: string | Types.ObjectId;
  roleCodes?: string[];
  userIds?: string[];
}

export interface INotifyAudienceOptions {
  audience: INotificationAudience;
  type: string;
  title: string;
  message: string;
  contextType: string;
  contextId: string | Types.ObjectId;
  threadId?: string | Types.ObjectId;
  financialYear?: string;
  redirectUrl: string;
  session?: ClientSession;
}

export interface ISendMessageOptions {
  threadId: string;
  body: string;
  attachments?: Record<string, unknown>[];
  visibility?: MESSAGE_VISIBILITY;
  parentMessageId?: string;
  isSystemGenerated?: boolean;
}
