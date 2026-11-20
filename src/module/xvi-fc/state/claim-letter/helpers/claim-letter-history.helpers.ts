import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { ClaimLetterHistorySortField, ClaimLetterHistoryStatusFilter } from '../constants/claim-letter.constants';
import { RETURNED_CLAIM_LETTER_STATUSES } from './claim-letter-returned.helpers';

/**
 * Each history Status filter as a batch query. Discarded uses the same rule as the "Discarded" label
 * (`mapClaimLetterBatchDocToSummary`): abandoned but not returned, since a return also sets `isAbandoned`.
 */
const HISTORY_STATUS_CONDITIONS: Readonly<Record<ClaimLetterHistoryStatusFilter, Record<string, unknown>>> = {
  IN_PROGRESS: { currentFormStatus: FORM_STATUS.IN_PROGRESS, isAbandoned: false },
  UNDER_REVIEW: { currentFormStatus: { $in: [FORM_STATUS.UNDER_REVIEW_BY_SO, FORM_STATUS.UNDER_REVIEW_BY_MOHUA] } },
  RETURNED: { currentFormStatus: { $in: RETURNED_CLAIM_LETTER_STATUSES } },
  ACKNOWLEDGED: { currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA },
  DISCARDED: { isAbandoned: true, currentFormStatus: { $nin: RETURNED_CLAIM_LETTER_STATUSES } },
};

const HISTORY_SORT_PATHS: Readonly<Record<ClaimLetterHistorySortField, readonly string[]>> = {
  updatedAt: ['updatedAt'],
  submittedAt: ['submittedAt'],
  batchNumber: ['batchNumber', 'resubmissionNumber'],
  ulbCount: ['ulbCount'],
  claimedTotal: ['financialSummary.currentSelectedClaim'],
};

export function historyStatusCondition(status: ClaimLetterHistoryStatusFilter): Record<string, unknown> {
  return HISTORY_STATUS_CONDITIONS[status];
}

/** The sort for one column; `_id` last, in the same direction, so paging never skips or repeats a letter. */
export function historySort(
  sortBy: ClaimLetterHistorySortField = 'updatedAt',
  sortOrder: 'asc' | 'desc' = 'desc',
): Record<string, 1 | -1> {
  const direction = sortOrder === 'asc' ? 1 : -1;
  const sort: Record<string, 1 | -1> = {};
  for (const path of HISTORY_SORT_PATHS[sortBy]) sort[path] = direction;
  sort['_id'] = direction;
  return sort;
}
