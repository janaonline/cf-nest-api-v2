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

/** Manual review is a last resort: an Annual Accounts document (Audited / Provisional) must have failed this many
 *  uploads in a row (the first upload and 2 re-uploads) before the ULB can ask for one. Retries of the same file
 *  don't count; a pass starts again from 0. */
export const MIN_FAILED_UPLOADS_FOR_MANUAL_REVIEW = 3;

/** The same rule for DUR documents, which allow it sooner: the first upload and 1 re-upload. */
export const DUR_MIN_FAILED_UPLOADS_FOR_MANUAL_REVIEW = 2;

/** A document slot's run of failed uploads, as `failedUploadsInARow` and the upload that last added to it. */
interface FailedUploadRun {
  failedUploadsInARow?: number | null;
  lastFailedUploadId?: string | null;
}

/**
 * The slot fields to write once an upload gets a verdict (`$set` paths under `documents.$`). A pass resets the run.
 * A real FAIL adds one, counted once per upload: a retry keeps its uploadId, so retrying the same file never adds
 * again, while a re-upload has a new uploadId. Returns {} when there is nothing to change.
 */
export function failedUploadRunUpdate(
  slot: FailedUploadRun | null | undefined,
  uploadId: string,
  passed: boolean,
): Record<string, unknown> {
  if (passed) return { 'documents.$.failedUploadsInARow': 0, 'documents.$.lastFailedUploadId': null };
  if (slot?.lastFailedUploadId === uploadId) return {};
  return {
    'documents.$.failedUploadsInARow': (slot?.failedUploadsInARow ?? 0) + 1,
    'documents.$.lastFailedUploadId': uploadId,
  };
}

/** True once the slot has failed `min` uploads in a row (Annual Accounts by default; DUR passes its own).
 *  Mirrors the UI's isEligibleForManualReview. */
export function hasEnoughFailedUploads(
  slot: FailedUploadRun | null | undefined,
  min: number = MIN_FAILED_UPLOADS_FOR_MANUAL_REVIEW,
): boolean {
  return (slot?.failedUploadsInARow ?? 0) >= min;
}

const firstAttemptMessage = (min: number) =>
  `Please re-upload a corrected document before requesting a manual review: it can be requested after ${min} failed uploads in a row.`;
export const FIRST_ATTEMPT_MESSAGE = firstAttemptMessage(MIN_FAILED_UPLOADS_FOR_MANUAL_REVIEW);
export const DUR_FIRST_ATTEMPT_MESSAGE = firstAttemptMessage(DUR_MIN_FAILED_UPLOADS_FOR_MANUAL_REVIEW);

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
