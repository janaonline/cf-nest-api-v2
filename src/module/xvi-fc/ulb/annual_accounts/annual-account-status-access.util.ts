import { canUlbEditForm } from '../../common/utils/xvi-fc-form-status-access.util';
import { AnnualAccountFormStatus, DecisionInfo } from '../../../../schemas/xvi-fc/annual-account.schema';

/** Computed per-section capability flags returned alongside annual account status data. */
export interface AnnualAccountPermissions {
  canView: boolean;
  canUpload: boolean;
  canReview: boolean;
  canApprove: boolean;
  canMohuaReview: boolean;
  canMohuaApprove: boolean;
}

/** Statuses in which a STATE user may open this section's documents for review. */
const STATE_REVIEWABLE_STATUSES: ReadonlySet<AnnualAccountFormStatus> = new Set([
  AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE,
]);

/** Statuses in which MOHUA may open this section for review. */
const MOHUA_REVIEWABLE_STATUSES: ReadonlySet<AnnualAccountFormStatus> = new Set([
  AnnualAccountFormStatus.UNDER_REVIEW_BY_MOHUA,
]);

/** Returns true if a STATE user may open this section's documents for review in the given status. */
export function canStateReviewAnnualAccount(status: AnnualAccountFormStatus): boolean {
  return STATE_REVIEWABLE_STATUSES.has(status);
}

/** Returns true if a STATE user may record an approve/return decision for this section in the given status. */
export function canStateDecideAnnualAccount(status: AnnualAccountFormStatus): boolean {
  return STATE_REVIEWABLE_STATUSES.has(status);
}

/** Returns true if MOHUA may open this section's handed-off submission for review in the given status. */
export function canMohuaReviewAnnualAccount(status: AnnualAccountFormStatus): boolean {
  return MOHUA_REVIEWABLE_STATUSES.has(status);
}

/** Returns true if MOHUA may record an approve/return decision for this section in the given status. */
export function canMohuaDecideAnnualAccount(status: AnnualAccountFormStatus): boolean {
  return MOHUA_REVIEWABLE_STATUSES.has(status);
}

/**
 * Two-layer upload gate for one document: the section itself must be ULB-editable
 * (shared FORM_STATUS gate — NOT_STARTED / IN_PROGRESS / RETURNED_BY_STATE / RETURNED_BY_MOHUA),
 * AND this specific document must not already be individually APPROVED — an approved
 * document stays locked even while the rest of the section is open for corrections.
 *
 * @param sectionFormStatusId - The section's `form_status_id` (shares numbering with the
 *   shared FORM_STATUS constants, so the shared gate can be reused directly).
 * @param documentStateDecision - That document's `stateDecision` array; only the last
 *   (current) entry matters.
 */
export function canUlbReuploadDocument(
  sectionFormStatusId: number,
  documentStateDecision: readonly DecisionInfo[] | undefined,
): boolean {
  if (!canUlbEditForm(sectionFormStatusId)) return false;
  const current = documentStateDecision?.[documentStateDecision.length - 1];
  return current?.status !== 'APPROVED';
}
