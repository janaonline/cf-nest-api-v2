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
 *  out of uploading a new version of this document for POST_REJECTION_COOLDOWN_DAYS. */
export const MAX_POST_REJECTION_ATTEMPTS = 3;
export const POST_REJECTION_COOLDOWN_DAYS = 7;

/** Inbox pointed to for ULBs who need help past the self-service attempt/cooldown flow. */
export const MANUAL_REVIEW_SUPPORT_EMAIL = '16fc.grant@cityfinance.in';

/** Shared copy for every "this document is upload-blocked" error — deliberately doesn't expose the
 *  exact unblock timestamp to the ULB, just points them at support. */
export const UPLOAD_BLOCKED_MESSAGE =
  `Too many failed attempts on this document. Uploads are temporarily blocked for ${POST_REJECTION_COOLDOWN_DAYS} days. ` +
  `For further details, please email ${MANUAL_REVIEW_SUPPORT_EMAIL}.`;

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

/** Once attemptsUsed reaches the cap, the document is blocked for POST_REJECTION_COOLDOWN_DAYS from
 *  now; otherwise no cooldown is set (returns null). */
export function computeUploadBlockedUntil(attemptsUsed: number): Date | null {
  if (attemptsUsed < MAX_POST_REJECTION_ATTEMPTS) return null;
  return new Date(Date.now() + POST_REJECTION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
}
