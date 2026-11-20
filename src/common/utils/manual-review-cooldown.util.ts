/**
 * Shared "post-manual-review-rejection" self-service policy — used by every xvi-fc ULB form that
 * puts a failed OCR/validation result through a manual-review escalation (Annual Accounts, DUR).
 * Form-agnostic: operates on plain primitives / a minimal decision shape, never a specific form's
 * schema types, so a new form can adopt it without any change here.
 */

interface ManualReviewDecisionLike {
  status: 'APPROVED' | 'RETURNED';
}

/** After this many failed re-upload attempts following a manual-review RETURN, the ULB is locked
 *  out of uploading a new version of this document for POST_REJECTION_COOLDOWN_HOURS. */
export const MAX_POST_REJECTION_ATTEMPTS = 3;
export const POST_REJECTION_COOLDOWN_HOURS = 24;

/** Inbox pointed to for ULBs who need help past the self-service attempt/cooldown flow. */
export const MANUAL_REVIEW_SUPPORT_EMAIL = '16fc.grant@cityfinance.in';

/** Shared copy for every "this document is upload-blocked" error — deliberately doesn't expose the
 *  exact unblock timestamp to the ULB, just points them at support. */
export const UPLOAD_BLOCKED_MESSAGE =
  `Too many failed attempts on this document. Uploads are temporarily blocked for ${POST_REJECTION_COOLDOWN_HOURS} hours. ` +
  `For further details, please email ${MANUAL_REVIEW_SUPPORT_EMAIL}.`;

/** Manual review is for a document the ULB already tried to fix: retried more than once on the same
 *  file, or re-uploaded (version 2+). Mirrors the UI's isEligibleForManualReview. */
export function isPastFirstAttempt(upload: { retryValidationCount?: number | null; version?: number | null }): boolean {
  return (upload.retryValidationCount ?? 0) > 1 || (upload.version ?? 1) > 1;
}

export const FIRST_ATTEMPT_MESSAGE = 'Please retry or re-upload the document before requesting a manual review.';

/** A ULB may throw away a document that already PASSED validation (remove it or upload over it) at most
 *  this many times; after that the passed document is locked. A State/SO return lifts the lock. */
export const MAX_PASSED_REPLACEMENTS = 3;

export const PASSED_REPLACEMENTS_EXHAUSTED_MESSAGE =
  `This document has already passed validation and has been replaced ${MAX_PASSED_REPLACEMENTS} times, the maximum allowed. ` +
  `For further changes, please email ${MANUAL_REVIEW_SUPPORT_EMAIL}.`;

/**
 * Discarding the current upload of a slot: is it allowed, and what should `passedReplacementsUsed` become?
 * Only a PASSED upload counts. A returned document is always replaceable and starts the count again.
 * Returns `null` when nothing changes (the upload had not passed).
 */
export function nextPassedReplacements(
  slot: { processingStatus?: string | null; passedReplacementsUsed?: number | null } | null | undefined,
  isReturned: boolean,
): { allowed: boolean; value: number } | null {
  if (slot?.processingStatus !== 'PASSED') return null;
  if (isReturned) return { allowed: true, value: 0 };
  const used = slot.passedReplacementsUsed ?? 0;
  return { allowed: used < MAX_PASSED_REPLACEMENTS, value: used + 1 };
}

/** Returns true while this document's `uploadBlockedUntil` cooldown is still in effect. */
export function isUploadBlocked(uploadBlockedUntil: Date | null | undefined): boolean {
  return !!uploadBlockedUntil && uploadBlockedUntil.getTime() > Date.now();
}

/**
 * Returns true if this document has a manual-review request outstanding with no ADMIN decision
 * recorded yet. While awaiting, the ULB must not be able to re-upload, retry, or remove this
 * document — doing so would change the file out from under the ADMIN mid-review (or silently
 * cancel the pending request).
 */
export function isAwaitingManualReviewDecision(
  isManualReviewRequested: boolean | null | undefined,
  manualReviewDecision: ManualReviewDecisionLike | null | undefined,
): boolean {
  return !!isManualReviewRequested && !manualReviewDecision;
}

/** `Math.min(current + 1, MAX_POST_REJECTION_ATTEMPTS)` — the attempt counter never exceeds the cap. */
export function nextPostRejectionAttempts(current: number): number {
  return Math.min((current ?? 0) + 1, MAX_POST_REJECTION_ATTEMPTS);
}

/** Once attemptsUsed reaches the cap, the document is blocked for POST_REJECTION_COOLDOWN_HOURS from
 *  now; otherwise no cooldown is set (returns null). */
export function computeUploadBlockedUntil(attemptsUsed: number): Date | null {
  if (attemptsUsed < MAX_POST_REJECTION_ATTEMPTS) return null;
  return new Date(Date.now() + POST_REJECTION_COOLDOWN_HOURS * 60 * 60 * 1000);
}
