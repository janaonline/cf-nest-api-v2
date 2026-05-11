import { Types } from 'mongoose';
import { MESSAGE_VISIBILITY } from '../../common/constants/communication.constants';

/** Plain-object shape returned by .lean() queries on messages. */
export interface IMessage {
  _id: Types.ObjectId;
  threadId: Types.ObjectId;
  contextType: string;
  contextId: Types.ObjectId;
  senderId: Types.ObjectId;
  senderOrgType?: string;
  senderOrgId?: Types.ObjectId;
  senderRoleCode?: string;
  messageType: string;
  visibility: MESSAGE_VISIBILITY;
  body: string;
  attachments: Record<string, unknown>[];
  parentMessageId?: Types.ObjectId;
  isSystemGenerated: boolean;
  createdAt: Date;
  updatedAt: Date;
}
