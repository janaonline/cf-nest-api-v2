import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { canStateEditForm, canStateFinalSubmitForm } from './xvi-fc-form-status-access.util';

/**
 * Returns true when the user is permitted to access data for the given state.
 * ADMIN bypasses state scope; STATE users must match their assigned state.
 * Shared across every xvi-fc state service - previously each one duplicated this check.
 */
export function hasStateAccess(user: AuthUser, stateId: string): boolean {
  if (user.scope === Scope.ADMIN) return true;
  if (user.scope === Scope.STATE) {
    const userStateId = toObjectIdString(user.state);
    return !!userStateId && userStateId === stateId;
  }
  return false;
}

/** Throws ForbiddenException when the user does not have access to the given state. */
export function assertStateAccess(user: AuthUser, stateId: string): void {
  if (!hasStateAccess(user, stateId)) {
    throw new ForbiddenException(
      user.scope === Scope.STATE ? 'You can only access your own state data' : 'Access denied',
    );
  }
}

export interface StateFormPermissions {
  canView: boolean;
  canEdit: boolean;
  canFinalSubmit: boolean;
}

/**
 * Derives the common canView/canEdit/canFinalSubmit triple shared by every plain state form
 * (SFC Status, GTC, Elected Urban Local Bodies, Devolution Formula): gated by the standard
 * VIEW_STATE_FORMS/EDIT_STATE_FORMS/FINAL_SUBMIT_STATE_FORMS permissions, state scope, and the
 * shared FORM_STATUS gate functions. A form with extra flags or extra gating conditions (e.g.
 * FC Unspent Declaration's Devolution-dependency gates, Request Exemption's single
 * RECOMMEND_EXEMPTIONS permission) builds its own shape instead of using this - only the forms
 * with this exact shape should call it.
 */
export function buildStateFormPermissions(user: AuthUser, stateId: string, status: number): StateFormPermissions {
  const perms = new Set(getEffectivePermissions(user));
  const hasAccess = hasStateAccess(user, stateId);
  return {
    canView: perms.has(Permission.VIEW_STATE_FORMS) && hasAccess,
    canEdit: perms.has(Permission.EDIT_STATE_FORMS) && hasAccess && canStateEditForm(status),
    canFinalSubmit: perms.has(Permission.FINAL_SUBMIT_STATE_FORMS) && hasAccess && canStateFinalSubmitForm(status),
  };
}
