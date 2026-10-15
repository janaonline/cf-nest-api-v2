import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { deriveStage, getStateFormStatusLabel, isFormCompleted } from './mohua-overview-stage.util';

describe('deriveStage', () => {
  const { NO_STATUS, NOT_STARTED, IN_PROGRESS, UNDER_REVIEW_BY_MOHUA, SUBMISSION_ACKNOWLEDGED_BY_MOHUA } = FORM_STATUS;

  it('is underReview when all five forms are under review or acknowledged by MoHUA', () => {
    expect(
      deriveStage([
        UNDER_REVIEW_BY_MOHUA,
        SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        UNDER_REVIEW_BY_MOHUA,
        UNDER_REVIEW_BY_MOHUA,
        UNDER_REVIEW_BY_MOHUA,
      ]),
    ).toBe('underReview');
  });

  it('is notStarted when every form is missing or not started', () => {
    expect(deriveStage([NO_STATUS, NOT_STARTED, NO_STATUS, NO_STATUS, NO_STATUS])).toBe('notStarted');
  });

  it('is inProgress when forms are mixed', () => {
    expect(deriveStage([UNDER_REVIEW_BY_MOHUA, NO_STATUS, NO_STATUS, NO_STATUS, NO_STATUS])).toBe('inProgress');
    expect(deriveStage([IN_PROGRESS, NO_STATUS, NO_STATUS, NO_STATUS, NO_STATUS])).toBe('inProgress');
  });

  it('treats a form under review by the State (not yet with MoHUA) as started but not completed', () => {
    const underReviewByState = FORM_STATUS.UNDER_REVIEW_BY_STATE;
    expect(
      deriveStage([
        underReviewByState,
        UNDER_REVIEW_BY_MOHUA,
        UNDER_REVIEW_BY_MOHUA,
        UNDER_REVIEW_BY_MOHUA,
        UNDER_REVIEW_BY_MOHUA,
      ]),
    ).toBe('inProgress');
  });

  it('treats 5, 8 and 13 as completed (submitted onward) and 0, 1, 2 as not', () => {
    expect([5, 8, 13].every(isFormCompleted)).toBe(true);
    expect([0, 1, 2].some(isFormCompleted)).toBe(false);
  });
});

describe('state-condition form status labels', () => {
  it('uses one common set of labels', () => {
    expect(getStateFormStatusLabel(0)).toBe('Not Started');
    expect(getStateFormStatusLabel(1)).toBe('Not Started');
    expect(getStateFormStatusLabel(2)).toBe('In Progress');
    expect(getStateFormStatusLabel(5)).toBe('Under Review by MoHUA');
    expect(getStateFormStatusLabel(8)).toBe('Under Review by MoHUA');
    expect(getStateFormStatusLabel(13)).toBe('Under Review by PMU');
  });

  it('falls back to the standard label for a returned-by-PMU form', () => {
    expect(getStateFormStatusLabel(14)).toBe('Returned by PMU');
  });
});
