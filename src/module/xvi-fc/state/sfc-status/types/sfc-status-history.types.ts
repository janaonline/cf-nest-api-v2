import { Types } from 'mongoose';
import { FormHistoryAction } from 'src/common/constants/form-status.constants';

/** Input shape for a single SFC Status history record. Passed to `createHistoryEntry`. */
export interface SfcHistoryEntryInput {
  sfcStatusFormId: Types.ObjectId;
  stateId: Types.ObjectId;
  yearId: Types.ObjectId;
  action: FormHistoryAction;
  fromStatus?: number;
  toStatus: number;
  changedBy: Types.ObjectId;
  ip?: string;
  userAgent?: string;
  remarks?: string;
  metadata?: Record<string, unknown>;
}
