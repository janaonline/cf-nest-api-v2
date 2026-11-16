import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { isReturnedClaimLetter } from './claim-letter-returned.helpers';

describe('isReturnedClaimLetter', () => {
  it('is true for a letter returned by the SO (16) or by MoHUA (6)', () => {
    expect(isReturnedClaimLetter(FORM_STATUS.RETURNED_BY_SO)).toBe(true);
    expect(isReturnedClaimLetter(FORM_STATUS.RETURNED_BY_MOHUA)).toBe(true);
  });

  it('is false for every other status, and for no status', () => {
    for (const status of [
      FORM_STATUS.IN_PROGRESS,
      FORM_STATUS.UNDER_REVIEW_BY_SO,
      FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
    ]) {
      expect(isReturnedClaimLetter(status)).toBe(false);
    }
    expect(isReturnedClaimLetter(null)).toBe(false);
    expect(isReturnedClaimLetter(undefined)).toBe(false);
  });
});
