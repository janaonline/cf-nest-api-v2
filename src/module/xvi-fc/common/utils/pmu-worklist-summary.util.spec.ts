import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { isPmuWorklistSummaryBalanced, summarizePmuWorklist } from './pmu-worklist-summary.util';

const row = (stateId: string, currentFormStatus: number) => ({ stateId, currentFormStatus });

describe('summarizePmuWorklist', () => {
  it('buckets every mapped status and sums to N', () => {
    const summary = summarizePmuWorklist([
      row('a', FORM_STATUS.NOT_STARTED),
      row('b', FORM_STATUS.NOT_STARTED),
      row('c', FORM_STATUS.IN_PROGRESS),
      row('d', FORM_STATUS.UNDER_REVIEW_BY_MOHUA),
      row('e', FORM_STATUS.UNDER_REVIEW_BY_PMU),
      row('f', FORM_STATUS.UNDER_REVIEW_BY_PMU),
      row('g', FORM_STATUS.RETURNED_BY_MOHUA),
      row('h', FORM_STATUS.RETURNED_BY_PMU),
      row('i', FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA),
    ]);

    expect(summary).toEqual({
      total: 9,
      statesInScope: 9,
      notStarted: 2,
      inProgress: 1,
      underReview: { mohua: 1, pmu: 2 },
      returned: { mohua: 1, pmu: 1 },
      acknowledged: 1,
    });
    expect(isPmuWorklistSummaryBalanced(summary)).toBe(true);
  });

  it('handles an empty scope without dividing or going negative', () => {
    const summary = summarizePmuWorklist([]);
    expect(summary).toMatchObject({ total: 0, statesInScope: 0, notStarted: 0, inProgress: 0, acknowledged: 0 });
    expect(isPmuWorklistSummaryBalanced(summary)).toBe(true);
  });

  it('counts distinct states, so two installment records of one state are "2 per state"', () => {
    const summary = summarizePmuWorklist([
      row('a', FORM_STATUS.IN_PROGRESS),
      row('a', FORM_STATUS.NOT_STARTED),
      row('b', FORM_STATUS.NOT_STARTED),
      row('b', FORM_STATUS.NOT_STARTED),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.statesInScope).toBe(2);
  });

  it('flags an unmapped status as unbalanced instead of hiding it', () => {
    const summary = summarizePmuWorklist([row('a', FORM_STATUS.NOT_STARTED), row('b', FORM_STATUS.APPROVED_BY_STATE)]);
    expect(summary.notStarted).toBe(1);
    expect(isPmuWorklistSummaryBalanced(summary)).toBe(false);
  });
});
