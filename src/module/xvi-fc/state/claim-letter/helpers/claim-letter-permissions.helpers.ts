import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';

/** Authoritative UI gates: the frontend reads these, never re-derives them from status. */
export interface ClaimLetterPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

/** Narrower than the shared canStateEditForm: no RETURNED_BY_MOHUA re-edit (a returned claim gets a
 *  new version, ADR 0003), and an abandoned batch is never editable. */
export function canEditClaimLetter(status: number, isAbandoned: boolean): boolean {
  return status === FORM_STATUS.IN_PROGRESS && !isAbandoned;
}

export function canFinalSubmitClaimLetter(status: number, isAbandoned: boolean): boolean {
  return canEditClaimLetter(status, isAbandoned);
}

/** Callers have already asserted state access, so it is not re-checked here. */
export function buildClaimLetterPermissions(
  user: AuthUser,
  status: number,
  isAbandoned: boolean,
): ClaimLetterPermissions {
  const perms = new Set(getEffectivePermissions(user));
  return {
    canView: perms.has(Permission.VIEW_STATE_FORMS),
    canEdit: perms.has(Permission.PREPARE_GRANT_LETTERS) && canEditClaimLetter(status, isAbandoned),
    canFinalSubmit: perms.has(Permission.FINAL_SUBMIT_TO_MOHUA) && canFinalSubmitClaimLetter(status, isAbandoned),
  };
}
