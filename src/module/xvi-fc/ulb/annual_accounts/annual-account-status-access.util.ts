import {
  canMohuaMutateForm,
  canStateReviewForm,
  canStateUndoFormApproval,
  canUlbEditForm,
} from '../../common/utils/xvi-fc-form-status-access.util';
import { AnnualAccountFormStatus, DecisionInfo, FORM_STATUS_ID } from '../../../../schemas/xvi-fc/annual-account.schema';

/** Computed per-section capability flags returned alongside annual account status data. */
export interface AnnualAccountPermissions {
  canView: boolean;
  canUpload: boolean;
  canReview: boolean;
  canApprove: boolean;
  /** True only while the section is APPROVED_BY_STATE — the door STATE can still undo through. */
  canUndoApproval: boolean;
  canMohuaReview: boolean;
  canMohuaApprove: boolean;
}

/**
 * These delegate to the shared, generic ULB-form status gates in
 * common/utils/xvi-fc-form-status-access.util.ts — that file is the single
 * source of truth for the underlying thresholds (3 / 8 / 5). This adapter only
 * exists to convert Annual Account's own AnnualAccountFormStatus enum to the
 * numeric status the shared functions expect.
 */

/** Returns true if a STATE user may open this section's documents for review in the given status. */
export function canStateReviewAnnualAccount(status: AnnualAccountFormStatus): boolean {
  return canStateReviewForm(FORM_STATUS_ID[status]);
}

/** Returns true if a STATE user may record an approve/return decision for this section in the given status. */
export function canStateDecideAnnualAccount(status: AnnualAccountFormStatus): boolean {
  return canStateReviewForm(FORM_STATUS_ID[status]);
}

/** Returns true if a STATE user may undo their own Approve Section decision in the given status. */
export function canStateUndoSectionApproval(status: AnnualAccountFormStatus): boolean {
  return canStateUndoFormApproval(FORM_STATUS_ID[status]);
}

/** Returns true if MOHUA may open this section's handed-off submission for review in the given status. */
export function canMohuaReviewAnnualAccount(status: AnnualAccountFormStatus): boolean {
  return canMohuaMutateForm(FORM_STATUS_ID[status]);
}

/** Returns true if MOHUA may record an approve/return decision for this section in the given status. */
export function canMohuaDecideAnnualAccount(status: AnnualAccountFormStatus): boolean {
  return canMohuaMutateForm(FORM_STATUS_ID[status]);
}

/**
 * Two-layer upload gate for one document: the section itself must be ULB-editable
 * (shared FORM_STATUS gate — NOT_STARTED / IN_PROGRESS / RETURNED_BY_STATE / RETURNED_BY_MOHUA),
 * AND this specific document must not already be individually APPROVED — an approved
 * document stays locked even while the rest of the section is open for corrections.
 *
 * @param sectionFormStatusId - The section's `form_status_id` (shares numbering with the
 *   shared FORM_STATUS constants, so the shared gate can be reused directly).
 * @param documentStateDecision - That document's current `stateDecision`, or null/undefined
 *   if undecided.
 */
export function canUlbReuploadDocument(
  sectionFormStatusId: number,
  documentStateDecision: DecisionInfo | null | undefined,
): boolean {
  if (!canUlbEditForm(sectionFormStatusId)) return false;
  return documentStateDecision?.status !== 'APPROVED';
}
