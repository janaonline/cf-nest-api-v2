import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';

/** Authoritative UI gates for a claim letter — the frontend must read these directly, never infer
 *  `canEdit`/`canFinalSubmit` from `currentFormStatus`/`isAbandoned` locally (matches the
 *  convention documented on `FcUnspentPermissions` and implemented by `sfc-status`'s
 *  `buildFormPermissions`). */
export interface ClaimLetterPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

/**
 * Returns true if a claim letter batch in the given status may be edited (ULB selections changed,
 * abandoned, signed file uploaded). Narrower than the generic `canStateEditForm` in
 * `xvi-fc/common/utils/xvi-fc-form-status-access.util.ts` (which also allows `RETURNED_BY_MOHUA` —
 * claim-letter has no such re-edit path; a returned/superseded claim only ever gets a brand new
 * version via `createNewVersion`, per ADR 0003) and additionally accounts for `isAbandoned`, which
 * that generic util has no concept of.
 */
export function canEditClaimLetter(status: number, isAbandoned: boolean): boolean {
  return status === FORM_STATUS.IN_PROGRESS && !isAbandoned;
}

/** Same gate as `canEditClaimLetter` today — submit and edit/save share the same allowed status. */
export function canFinalSubmitClaimLetter(status: number, isAbandoned: boolean): boolean {
  return canEditClaimLetter(status, isAbandoned);
}

/**
 * Builds the `permissions` object attached to every `ClaimLetterBatchSummary` response.
 *
 * Callers must already have verified state access (every current call site does, via
 * `assertStateAccess`/`hasStateAccess`, before reaching this) — access is deliberately not
 * re-checked here, unlike `sfc-status`'s `buildFormPermissions` which folds a `hasAccess` check in
 * because it's called from more places that don't all pre-assert it the same way.
 */
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
