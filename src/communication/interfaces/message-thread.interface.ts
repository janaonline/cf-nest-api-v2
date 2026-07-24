import { Types } from 'mongoose';
import { THREAD_STATUS } from '../../common/constants/communication.constants';

/** Plain-object shape returned by .lean() queries on message_threads. */
export interface IMessageThread {
  _id: Types.ObjectId;
  contextType: string;
  contextId: Types.ObjectId;
  threadPurpose: string;
  financialYear?: string;
  formTemplateId?: Types.ObjectId;
  formCode?: string;
  formName?: string;
  ulbId?: Types.ObjectId;
  stateId?: Types.ObjectId;
  title?: string;
  status: THREAD_STATUS;
  currentFormStatus?: number;
  lastMessageAt?: Date;
  lastMessagePreview?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
