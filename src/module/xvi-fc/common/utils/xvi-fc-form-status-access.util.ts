import { ForbiddenException } from '@nestjs/common';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';

/** Statuses in which a ULB user may save or edit a ULB form. */
const ULB_EDITABLE_STATUSES: Set<number> = new Set([
  FORM_STATUS.NOT_STARTED,
  FORM_STATUS.IN_PROGRESS,
  FORM_STATUS.RETURNED_BY_STATE,
  FORM_STATUS.RETURNED_BY_MOHUA,
]);

/** Statuses in which a STATE user may save, edit, or final-submit a state form. */
const STATE_EDITABLE_STATUSES: Set<number> = new Set([
  FORM_STATUS.NOT_STARTED,
  FORM_STATUS.IN_PROGRESS,
  FORM_STATUS.RETURNED_BY_MOHUA,
]);

/**
 * Returns true if a STATE user may open or decide (approve/return) a ULB-submitted form
 * in the given status. Shared across every ULB form (Annual Account, Bank Account, ...) —
 * a single source of truth for the "under review by state" threshold.
 */
export function canStateReviewForm(status: number): boolean {
  return status === FORM_STATUS.UNDER_REVIEW_BY_STATE;
}

/**
 * Returns true if a STATE user may undo their own Approve decision on a ULB-submitted form
 * in the given status. Shared across every ULB form.
 */
export function canStateUndoFormApproval(status: number): boolean {
  return status === FORM_STATUS.APPROVED_BY_STATE;
}

/**
 * Returns true if a ULB user may save or edit a form in the given status.
 */
export function canUlbEditForm(status: number): boolean {
  return ULB_EDITABLE_STATUSES.has(status);
}

/**
 * Returns true if a ULB user may submit a form in the given status.
 * ULB submit and save share the same allowed-status gate.
 */
export function canUlbSubmitForm(status: number): boolean {
  return ULB_EDITABLE_STATUSES.has(status);
}

/**
 * Throws ForbiddenException if the current form status does not allow a ULB user to save/edit.
 * @param status - Current `currentFormStatus` value from the form document.
 */
export function assertCanUlbEditForm(status: number): void {
  if (!canUlbEditForm(status)) {
    throw new ForbiddenException(`Form cannot be edited when status is ${getFormStatusLabel(status)}.`);
  }
}

/**
 * Throws ForbiddenException if the current form status does not allow a ULB user to submit.
 * @param status - Current `currentFormStatus` value from the form document.
 */
export function assertCanUlbSubmitForm(status: number): void {
  if (!canUlbSubmitForm(status)) {
    throw new ForbiddenException(`Form cannot be submitted when status is ${getFormStatusLabel(status)}.`);
  }
}

/**
 * Returns true if a STATE user may save or edit a state form in the given status.
 */
export function canStateEditForm(status: number): boolean {
  return STATE_EDITABLE_STATUSES.has(status);
}

/**
 * Returns true if a STATE user may final-submit a state form in the given status.
 */
export function canStateFinalSubmitForm(status: number): boolean {
  return STATE_EDITABLE_STATUSES.has(status);
}

/**
 * Throws ForbiddenException if the current form status does not allow a STATE user to save/edit.
 * @param status - Current `currentFormStatus` value from the form document.
 */
export function assertCanStateEditForm(status: number): void {
  if (!canStateEditForm(status)) {
    throw new ForbiddenException(`Form cannot be edited when status is ${getFormStatusLabel(status)}.`);
  }
}

/**
 * Throws ForbiddenException if the current form status does not allow a STATE user to final-submit.
 * @param status - Current `currentFormStatus` value from the form document.
 */
export function assertCanStateFinalSubmitForm(status: number): void {
  if (!canStateFinalSubmitForm(status)) {
    throw new ForbiddenException(`Form cannot be final submitted when status is ${getFormStatusLabel(status)}.`);
  }
}

/** Statuses in which a MoHUA user may view a form's review page (read-only once acknowledged). */
export const MOHUA_REVIEWABLE_STATUSES: readonly number[] = [
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
];

const MOHUA_REVIEWABLE_STATUS_SET = new Set(MOHUA_REVIEWABLE_STATUSES);

/** Returns true if a MoHUA user may view the review page for a form in the given status. */
export function canMohuaViewForm(status: number): boolean {
  return MOHUA_REVIEWABLE_STATUS_SET.has(status);
}

/**
 * Returns true if a MoHUA user may mutate a form (row-level or complete-form decisions) in the
 * given status. Only `UNDER_REVIEW_BY_MOHUA` is mutable — once acknowledged, the form is terminal.
 */
export function canMohuaMutateForm(status: number): boolean {
  return status === FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
}

/**
 * Throws ForbiddenException if the current form status does not allow a MoHUA user to mutate it
 * (row-level review decisions or a complete-form approve/reject).
 * @param status - Current `currentFormStatus` value from the form document.
 */
export function assertCanMohuaMutateForm(status: number): void {
  if (!canMohuaMutateForm(status)) {
    throw new ForbiddenException(`Form cannot be reviewed when status is ${getFormStatusLabel(status)}.`);
  }
}

/** Statuses in which the post-submission update page is available. */
export const POST_SUBMISSION_UPDATE_ALLOWED_STATUSES: readonly number[] = [
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
];

const POST_SUBMISSION_UPDATE_STATUS_SET = new Set(POST_SUBMISSION_UPDATE_ALLOWED_STATUSES);

/** Returns true if the post-submission update page is accessible for the given form status. */
export function canViewPostSubmissionUpdate(status: number): boolean {
  return POST_SUBMISSION_UPDATE_STATUS_SET.has(status);
}

/**
 * Throws ForbiddenException if the form status does not allow post-submission updates.
 * @param status - Current `currentFormStatus` value from the form document.
 */
export function assertCanViewPostSubmissionUpdate(status: number): void {
  if (!canViewPostSubmissionUpdate(status)) {
    throw new ForbiddenException(
      `Post-submission update is not available when form status is ${getFormStatusLabel(status)}.`,
    );
  }
}
