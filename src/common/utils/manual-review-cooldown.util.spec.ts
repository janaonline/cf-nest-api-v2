import {
  MAX_POST_REJECTION_ATTEMPTS,
  MIN_FAILED_UPLOADS_FOR_MANUAL_REVIEW,
  DUR_MIN_FAILED_UPLOADS_FOR_MANUAL_REVIEW,
  POST_REJECTION_COOLDOWN_HOURS,
  computeUploadBlockedUntil,
  isAwaitingManualReviewDecision,
  isUploadBlocked,
  nextPassedReplacements,
  nextPostRejectionAttempts,
  failedUploadRunUpdate,
  hasEnoughFailedUploads,
} from './manual-review-cooldown.util';

describe('nextPassedReplacements', () => {
  it('counts nothing when the current upload had not passed', () => {
    expect(nextPassedReplacements({ processingStatus: 'FAILED', passedReplacementsUsed: 3 }, false)).toBeNull();
    expect(nextPassedReplacements(undefined, false)).toBeNull();
  });

  it('allows up to 3 replacements of a passed document, then refuses the 4th', () => {
    expect(nextPassedReplacements({ processingStatus: 'PASSED' }, false)).toEqual({ allowed: true, value: 1 });
    expect(nextPassedReplacements({ processingStatus: 'PASSED', passedReplacementsUsed: 2 }, false)).toEqual({
      allowed: true,
      value: 3,
    });
    expect(nextPassedReplacements({ processingStatus: 'PASSED', passedReplacementsUsed: 3 }, false)?.allowed).toBe(
      false,
    );
  });

  it('always allows a returned document and resets its count', () => {
    expect(nextPassedReplacements({ processingStatus: 'PASSED', passedReplacementsUsed: 3 }, true)).toEqual({
      allowed: true,
      value: 0,
    });
  });
});

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

describe('failedUploadRunUpdate / hasEnoughFailedUploads', () => {
  it('adds one per failed upload, but not again for a retry of the same upload', () => {
    expect(failedUploadRunUpdate(null, 'u1', false)).toEqual({
      'documents.$.failedUploadsInARow': 1,
      'documents.$.lastFailedUploadId': 'u1',
    });
    expect(failedUploadRunUpdate({ failedUploadsInARow: 1, lastFailedUploadId: 'u1' }, 'u1', false)).toEqual({});
    expect(failedUploadRunUpdate({ failedUploadsInARow: 1, lastFailedUploadId: 'u1' }, 'u2', false)).toMatchObject({
      'documents.$.failedUploadsInARow': 2,
    });
  });

  it('resets on a pass', () => {
    expect(failedUploadRunUpdate({ failedUploadsInARow: 3, lastFailedUploadId: 'u3' }, 'u4', true)).toEqual({
      'documents.$.failedUploadsInARow': 0,
      'documents.$.lastFailedUploadId': null,
    });
  });

  it(`allows a manual review only from ${MIN_FAILED_UPLOADS_FOR_MANUAL_REVIEW} failed uploads in a row`, () => {
    expect(hasEnoughFailedUploads({ failedUploadsInARow: 2 })).toBe(false);
    expect(hasEnoughFailedUploads({ failedUploadsInARow: 3 })).toBe(true);
    expect(hasEnoughFailedUploads(undefined)).toBe(false);
  });

  it(`allows a DUR manual review from ${DUR_MIN_FAILED_UPLOADS_FOR_MANUAL_REVIEW} failed uploads in a row`, () => {
    expect(hasEnoughFailedUploads({ failedUploadsInARow: 1 }, DUR_MIN_FAILED_UPLOADS_FOR_MANUAL_REVIEW)).toBe(false);
    expect(hasEnoughFailedUploads({ failedUploadsInARow: 2 }, DUR_MIN_FAILED_UPLOADS_FOR_MANUAL_REVIEW)).toBe(true);
  });
});
