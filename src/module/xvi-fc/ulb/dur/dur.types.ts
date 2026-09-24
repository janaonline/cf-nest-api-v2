import type { FormStatusType } from 'src/common/constants/form-status.constants';

export interface DurFormLogEntry {
  action: 'SUBMITTED' | 'APPROVED' | 'RETURNED' | 'UNDO';
  toStatus: FormStatusType;
  toStatusLabel: string;
  actorStage: 'ULB' | 'STATE' | 'MOHUA';
  actorRole: string;
  note: string | null;
  batchId: string | null;
  createdAt: Date;
}

/** Status-aware capability flags for the STATE reviewer UI — mirrors BankAccountPermissions. */
export interface DurPermissions {
  canReview: boolean;
  canApprove: boolean;
  canUndoApproval: boolean;
}
