import { ForbiddenException } from '@nestjs/common';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';

/** Statuses in which a ULB user may save or edit a ULB form.
 * Also exported as a plain array (ULB_EDITABLE_STATUS_IDS) for use cases that can't call canUlbEditForm, such as MongoDB aggregation or cross-collection status checks.
 */
const ULB_EDITABLE_STATUSES: Set<number> = new Set([
  FORM_STATUS.NOT_STARTED,
  FORM_STATUS.IN_PROGRESS,
  FORM_STATUS.RETURNED_BY_STATE,
  FORM_STATUS.RETURNED_BY_MOHUA,
]);

export const ULB_EDITABLE_STATUS_IDS: readonly number[] = [...ULB_EDITABLE_STATUSES];

/** Statuses in which a STATE user may save, edit, or final-submit a state form.
 * Also exported as a plain array (STATE_EDITABLE_STATUS_IDS) for use cases that can't call
 * canStateEditForm/canStateFinalSubmitForm, such as MongoDB aggregation or cross-collection status
 * checks (e.g. Request Exemption's whole-state branch checking a target state form's own progress).
 *
 * Includes `RETURNED_BY_PMU` alongside the legacy `RETURNED_BY_MOHUA` (PMU Review feature) — a PMU
 * rejection must send the state back into edit/resubmit mode the same way a MoHUA rejection always
 * has. Rationale: see common/services/CLAUDE.md's "PMU Review shared mechanics" section.
 */
const STATE_EDITABLE_STATUSES: Set<number> = new Set([
  FORM_STATUS.NOT_STARTED,
  FORM_STATUS.IN_PROGRESS,
  FORM_STATUS.RETURNED_BY_MOHUA,
  FORM_STATUS.RETURNED_BY_PMU,
]);

export const STATE_EDITABLE_STATUS_IDS: readonly number[] = [...STATE_EDITABLE_STATUSES];

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

/** Statuses in which a PMU user may view a form's review page (PMU Review feature); deliberately
 *  wider than `PMU_REVIEWABLE_STATUSES`'s mutate-gate counterpart below, and doubles as the
 *  cross-state worklist's own `$in` visibility filter. Full rationale: see
 *  common/services/CLAUDE.md's "PMU Review shared mechanics" section. */
export const PMU_REVIEWABLE_STATUSES: readonly number[] = [
  FORM_STATUS.UNDER_REVIEW_BY_PMU,
  FORM_STATUS.RETURNED_BY_PMU,
  FORM_STATUS.NOT_STARTED,
  FORM_STATUS.IN_PROGRESS,
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.RETURNED_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
];

const PMU_REVIEWABLE_STATUS_SET = new Set(PMU_REVIEWABLE_STATUSES);

export function canPmuViewForm(status: number): boolean {
  return PMU_REVIEWABLE_STATUS_SET.has(status);
}

/**
 * Only `UNDER_REVIEW_BY_PMU` is mutable — once approved, the form is settled for this stage.
 * Deliberately separate from `canMohuaMutateForm` above, which is shared with Annual Accounts' own,
 * unrelated MoHUA review and must keep its existing meaning.
 */
export function canPmuMutateForm(status: number): boolean {
  return status === FORM_STATUS.UNDER_REVIEW_BY_PMU;
}

export function assertCanPmuMutateForm(status: number): void {
  if (!canPmuMutateForm(status)) {
    throw new ForbiddenException(`Form cannot be reviewed when status is ${getFormStatusLabel(status)}.`);
  }
}

/** Statuses in which the post-submission update page is available. Sole consumer today is Elected
 *  Body (PMU Review feature retargeted its `finalSubmit` to land on `UNDER_REVIEW_BY_PMU` instead
 *  of `UNDER_REVIEW_BY_MOHUA` — without adding the PMU status here, this page would become
 *  unreachable the moment a form leaves draft). */
export const POST_SUBMISSION_UPDATE_ALLOWED_STATUSES: readonly number[] = [
  FORM_STATUS.UNDER_REVIEW_BY_PMU,
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
