import { BadRequestException } from '@nestjs/common';
import { FORM_STATUS, getFormStatusLabel } from '../constants/form-status.constants';

/**
 * Defines which target statuses are reachable from each source status.
 * Keyed by source status; values are arrays of allowed target statuses.
 */
const ALLOWED_TRANSITIONS: Record<number, number[]> = {
  [FORM_STATUS.NO_STATUS]: [FORM_STATUS.NOT_STARTED, FORM_STATUS.IN_PROGRESS],
  [FORM_STATUS.NOT_STARTED]: [FORM_STATUS.IN_PROGRESS],
  [FORM_STATUS.IN_PROGRESS]: [FORM_STATUS.IN_PROGRESS, FORM_STATUS.UNDER_REVIEW_BY_STATE],
  // State approval now lands on APPROVED_BY_STATE (8) first, not straight to MOHUA review —
  // see APPROVED_BY_STATE's own entry below for what follows.
  [FORM_STATUS.UNDER_REVIEW_BY_STATE]: [FORM_STATUS.RETURNED_BY_STATE, FORM_STATUS.APPROVED_BY_STATE],
  [FORM_STATUS.RETURNED_BY_STATE]: [FORM_STATUS.IN_PROGRESS, FORM_STATUS.UNDER_REVIEW_BY_STATE],
  [FORM_STATUS.UNDER_REVIEW_BY_MOHUA]: [FORM_STATUS.RETURNED_BY_MOHUA, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA],
  [FORM_STATUS.RETURNED_BY_MOHUA]: [FORM_STATUS.IN_PROGRESS, FORM_STATUS.UNDER_REVIEW_BY_STATE],
  [FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA]: [],
  // STATE may undo their own approval (lands straight back on 3 — status 10 is a log-only
  // marker, the live document is never actually set to it) or, once the Generate Claim Letter
  // feature confirms every form for this ULB+year is here too, move on to AWAITING_CLAIM_LETTER.
  [FORM_STATUS.APPROVED_BY_STATE]: [FORM_STATUS.UNDER_REVIEW_BY_STATE, FORM_STATUS.AWAITING_CLAIM_LETTER],
  [FORM_STATUS.AWAITING_CLAIM_LETTER]: [FORM_STATUS.UNDER_REVIEW_BY_MOHUA],
};

/**
 * Checks if a form can transition from one status to another.
 * @param fromStatus Current form status.
 * @param toStatus Target form status.
 * @returns True if the transition is defined in ALLOWED_TRANSITIONS.
 */
export function canTransitionFormStatus(fromStatus: number, toStatus: number): boolean {
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}

/**
 * Validates a status transition and throws if it is not allowed.
 * @param fromStatus Current form status.
 * @param toStatus Target form status.
 * @throws BadRequestException if the transition is invalid.
 */
export function assertValidFormStatusTransition(fromStatus: number, toStatus: number): void {
  if (!canTransitionFormStatus(fromStatus, toStatus)) {
    throw new BadRequestException(
      `Invalid status transition: "${getFormStatusLabel(fromStatus)}" → "${getFormStatusLabel(toStatus)}"`,
    );
  }
}

/**
 * Returns all valid next statuses reachable from the current status.
 * @param currentStatus Form's current status.
 * @returns Array of allowed target statuses, or empty array if terminal.
 */
export function getAllowedNextStatuses(currentStatus: number): number[] {
  return ALLOWED_TRANSITIONS[currentStatus] ?? [];
}
