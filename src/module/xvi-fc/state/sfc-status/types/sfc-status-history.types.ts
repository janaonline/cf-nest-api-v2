import { Types } from 'mongoose';

/** String-literal union of the actions that trigger a history entry. */
export type SfcStatusHistoryAction = 'CREATE_DRAFT' | 'UPDATE_DRAFT' | 'FINAL_SUBMIT';

/** Input shape for a single SFC Status history record. Passed to `createHistoryEntry`. */
export interface SfcHistoryEntryInput {
  sfcStatusFormId: Types.ObjectId;
  stateId: Types.ObjectId;
  yearId: Types.ObjectId;
  action: SfcStatusHistoryAction;
  fromStatus?: number;
  toStatus: number;
  changedBy: Types.ObjectId;
  ip?: string;
  userAgent?: string;
  remarks?: string;
  metadata?: Record<string, unknown>;
}
