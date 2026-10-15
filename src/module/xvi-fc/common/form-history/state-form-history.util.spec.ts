import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { Types } from 'mongoose';
import { decodeHistoryCursor, deriveActorRole, encodeHistoryCursor, isReturnedStatus } from './state-form-history.util';

describe('state-form-history.util', () => {
  describe('history cursor', () => {
    it('round-trips a time + row id', () => {
      const id = new Types.ObjectId();
      const at = new Date('2026-09-16T05:35:00.123Z');
      const decoded = decodeHistoryCursor(encodeHistoryCursor(at, id));
      expect(decoded?.changedAt.toISOString()).toBe(at.toISOString());
      expect(decoded?.id.equals(id)).toBe(true);
    });

    it('rejects malformed cursors', () => {
      expect(decodeHistoryCursor('nope')).toBeNull();
      expect(decodeHistoryCursor('2026-09-16T05:35:00Z_xyz')).toBeNull();
      expect(decodeHistoryCursor('2026-13-45T99:99:99Z_' + new Types.ObjectId().toString())).toBeNull();
    });
  });

  describe('deriveActorRole', () => {
    it('attributes PMU returns to PMU', () => {
      expect(deriveActorRole(FORM_STATUS.UNDER_REVIEW_BY_PMU, FORM_STATUS.RETURNED_BY_PMU)).toBe('PMU');
    });

    it('attributes MoHUA statuses to MoHUA', () => {
      expect(deriveActorRole(FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.RETURNED_BY_MOHUA)).toBe('MoHUA');
      expect(deriveActorRole(FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA)).toBe(
        'MoHUA',
      );
    });

    it('treats UNDER_REVIEW_BY_MOHUA as a PMU approval only when it came from PMU review', () => {
      expect(deriveActorRole(FORM_STATUS.UNDER_REVIEW_BY_PMU, FORM_STATUS.UNDER_REVIEW_BY_MOHUA)).toBe('PMU');
      expect(deriveActorRole(FORM_STATUS.IN_PROGRESS, FORM_STATUS.UNDER_REVIEW_BY_MOHUA)).toBe('State');
    });

    it('defaults to State for drafts and submissions', () => {
      expect(deriveActorRole(undefined, FORM_STATUS.IN_PROGRESS)).toBe('State');
      expect(deriveActorRole(FORM_STATUS.IN_PROGRESS, FORM_STATUS.UNDER_REVIEW_BY_PMU)).toBe('State');
    });
  });

  it('isReturnedStatus flags only the three "returned" statuses', () => {
    expect(isReturnedStatus(FORM_STATUS.RETURNED_BY_PMU)).toBe(true);
    expect(isReturnedStatus(FORM_STATUS.RETURNED_BY_MOHUA)).toBe(true);
    expect(isReturnedStatus(FORM_STATUS.RETURNED_BY_STATE)).toBe(true);
    expect(isReturnedStatus(FORM_STATUS.UNDER_REVIEW_BY_PMU)).toBe(false);
  });
});
