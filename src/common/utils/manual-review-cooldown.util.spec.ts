import {
  MAX_POST_REJECTION_ATTEMPTS,
  POST_REJECTION_COOLDOWN_HOURS,
  computeUploadBlockedUntil,
  isAwaitingManualReviewDecision,
  isUploadBlocked,
  nextPostRejectionAttempts,
} from './manual-review-cooldown.util';

describe('nextPostRejectionAttempts', () => {
  it('increments by one', () => {
    expect(nextPostRejectionAttempts(0)).toBe(1);
    expect(nextPostRejectionAttempts(1)).toBe(2);
  });

  it('never exceeds MAX_POST_REJECTION_ATTEMPTS', () => {
    expect(nextPostRejectionAttempts(MAX_POST_REJECTION_ATTEMPTS)).toBe(MAX_POST_REJECTION_ATTEMPTS);
    expect(nextPostRejectionAttempts(MAX_POST_REJECTION_ATTEMPTS + 5)).toBe(MAX_POST_REJECTION_ATTEMPTS);
  });

  it('treats a missing/undefined current count as zero', () => {
    expect(nextPostRejectionAttempts(undefined as unknown as number)).toBe(1);
  });
});

describe('computeUploadBlockedUntil', () => {
  it('returns null below the attempt cap — no cooldown yet', () => {
    expect(computeUploadBlockedUntil(MAX_POST_REJECTION_ATTEMPTS - 1)).toBeNull();
  });

  it('sets a cooldown exactly POST_REJECTION_COOLDOWN_HOURS from now once the cap is reached', () => {
    const before = Date.now();
    const blockedUntil = computeUploadBlockedUntil(MAX_POST_REJECTION_ATTEMPTS);
    const after = Date.now();

    expect(blockedUntil).not.toBeNull();
    const expectedMs = POST_REJECTION_COOLDOWN_HOURS * 60 * 60 * 1000;
    expect(blockedUntil!.getTime()).toBeGreaterThanOrEqual(before + expectedMs);
    expect(blockedUntil!.getTime()).toBeLessThanOrEqual(after + expectedMs);
  });

  it('is pinned to 24 hours — guards against an accidental revert to a days-based duration', () => {
    expect(POST_REJECTION_COOLDOWN_HOURS).toBe(24);
  });
});

describe('isUploadBlocked', () => {
  it('is false when there is no cooldown timestamp', () => {
    expect(isUploadBlocked(null)).toBe(false);
    expect(isUploadBlocked(undefined)).toBe(false);
  });

  it('is true while the cooldown timestamp is still in the future', () => {
    expect(isUploadBlocked(new Date(Date.now() + 60_000))).toBe(true);
  });

  it('is false once the cooldown timestamp has passed', () => {
    expect(isUploadBlocked(new Date(Date.now() - 60_000))).toBe(false);
  });
});

describe('isAwaitingManualReviewDecision', () => {
  it('is true when requested and not yet decided', () => {
    expect(isAwaitingManualReviewDecision(true, null)).toBe(true);
  });

  it('is false when not requested', () => {
    expect(isAwaitingManualReviewDecision(false, null)).toBe(false);
  });

  it('is false once a decision has been recorded', () => {
    expect(isAwaitingManualReviewDecision(true, { status: 'RETURNED' })).toBe(false);
  });
});
