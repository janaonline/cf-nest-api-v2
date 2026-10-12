import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { PmuWorklistRow, PmuWorklistSummary } from '../types/pmu-worklist.type';

/**
 * Counts the overview-card buckets over `rows` (already scoped to the selected form/state/installment,
 * and deliberately NOT narrowed by the Form Status filter, so every card keeps showing the full spread).
 *
 * Not Started follows the product formula `N - count(status other than Not Started)` rather than counting
 * Not Started rows directly, so the five buckets sum to N by construction whenever every non-Not-Started
 * status is mapped below; an unmapped status (or duplicate records) makes `isPmuWorklistSummaryBalanced`
 * return false.
 */
export function summarizePmuWorklist(
  rows: readonly Pick<PmuWorklistRow, 'stateId' | 'currentFormStatus'>[],
): PmuWorklistSummary {
  let nonNotStarted = 0;
  let inProgress = 0;
  let underReviewMohua = 0;
  let underReviewPmu = 0;
  let returnedMohua = 0;
  let returnedPmu = 0;
  let acknowledged = 0;
  const states = new Set<string>();

  for (const row of rows) {
    states.add(row.stateId);
    if (row.currentFormStatus === FORM_STATUS.NOT_STARTED) continue;
    nonNotStarted++;

    switch (row.currentFormStatus) {
      case FORM_STATUS.IN_PROGRESS:
        inProgress++;
        break;
      case FORM_STATUS.UNDER_REVIEW_BY_MOHUA:
        underReviewMohua++;
        break;
      case FORM_STATUS.UNDER_REVIEW_BY_PMU:
        underReviewPmu++;
        break;
      case FORM_STATUS.RETURNED_BY_MOHUA:
        returnedMohua++;
        break;
      case FORM_STATUS.RETURNED_BY_PMU:
        returnedPmu++;
        break;
      case FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA:
        acknowledged++;
        break;
      // Any other status is deliberately left unmapped: it counts as "not Not Started" above but lands in
      // no card, which is exactly what the balance check below is there to catch.
    }
  }

  return {
    total: rows.length,
    statesInScope: states.size,
    notStarted: rows.length - nonNotStarted,
    inProgress,
    underReview: { mohua: underReviewMohua, pmu: underReviewPmu },
    returned: { mohua: returnedMohua, pmu: returnedPmu },
    acknowledged,
  };
}

/** The five cards (Not Started + In Progress + Under Review + Returned + Acknowledged) must add up to N. */
export function isPmuWorklistSummaryBalanced(summary: PmuWorklistSummary): boolean {
  const sum =
    summary.notStarted +
    summary.inProgress +
    summary.underReview.mohua +
    summary.underReview.pmu +
    summary.returned.mohua +
    summary.returned.pmu +
    summary.acknowledged;
  return sum === summary.total;
}
