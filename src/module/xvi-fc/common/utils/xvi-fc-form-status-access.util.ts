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
