import { Types } from 'mongoose';

/** Plain-object shape returned by .lean() queries on thread_read_states. */
export interface IThreadReadState {
  _id: Types.ObjectId;
  threadId: Types.ObjectId;
  userId: Types.ObjectId;
  lastReadAt?: Date;
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
}
