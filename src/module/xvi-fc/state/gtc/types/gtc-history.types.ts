import { Types } from 'mongoose';
import { FormHistoryAction } from 'src/common/constants/form-status.constants';
import type { GtcInstallment } from '../constants/gtc.constants';

/** Input shape for a single GTC history record. Passed to `createHistoryEntry`. */
export interface GtcHistoryEntryInput {
  gtcFormId: Types.ObjectId;
  stateId: Types.ObjectId;
  yearId: Types.ObjectId;
  installment: GtcInstallment;
  action: FormHistoryAction;
  fromStatus?: number;
  toStatus: number;
  changedBy: Types.ObjectId;
  ip?: string;
  userAgent?: string;
  remarks?: string;
  metadata?: Record<string, unknown>;
}
