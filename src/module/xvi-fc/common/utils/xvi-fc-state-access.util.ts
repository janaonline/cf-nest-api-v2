import { ForbiddenException } from '@nestjs/common';
import type { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import type { UlbDocument } from 'src/schemas/ulb.schema';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { isAdcUser } from 'src/module/auth/roles-xvi-fc.helper';
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

export interface UlbOwnership {
  state?: unknown;
  adc?: unknown;
}

/**
 * Per-ULB view access for the STATE scope. ADMIN sees everything; a State user sees every ULB in their state
 * (ADC-owned ones read-only); an ADC user sees only the ULBs owned by their own ADC.
 * Compares the ULB's *current* `adc` every time, so reassigning a ULB moves access immediately.
 */
export function canViewUlb(user: AuthUser, ulb: UlbOwnership): boolean {
  if (user.scope === Scope.ADMIN) return true;
  if (user.scope !== Scope.STATE) return false;
  const userStateId = toObjectIdString(user.state);
  if (!userStateId || userStateId !== toObjectIdString(ulb.state)) return false;
  return isAdcUser(user) ? toObjectIdString(user.adc) === toObjectIdString(ulb.adc) : true;
}

/**
 * Per-ULB decision access (approve / return / undo, bulk included): the ULB's owner decides. An ADC user decides
 * only their own ADC's ULBs; a plain State user decides only the ULBs that have no ADC (ADC-owned ones are
 * view-only for the State, so it never re-reviews them).
 */
export function canDecideUlb(user: AuthUser, ulb: UlbOwnership): boolean {
  if (user.scope === Scope.ADMIN) return true;
  if (user.scope !== Scope.STATE) return false;
  const userStateId = toObjectIdString(user.state);
  if (!userStateId || userStateId !== toObjectIdString(ulb.state)) return false;
  const ulbAdcId = toObjectIdString(ulb.adc);
  return isAdcUser(user) ? !!ulbAdcId && ulbAdcId === toObjectIdString(user.adc) : !ulbAdcId;
}

/** Loads just the two fields canViewUlb / canDecideUlb read; null when the ULB does not exist. */
export function loadUlbOwnership(ulbModel: Model<UlbDocument>, ulbId: unknown): Promise<UlbOwnership | null> {
  return ulbModel
    .findById(ulbId as Types.ObjectId)
    .select('state adc')
    .lean<UlbOwnership>()
    .exec();
}

/** canViewUlb against the ULB's stored ownership. ADMIN needs no lookup; any non-STATE scope is false. */
export async function hasUlbViewAccess(user: AuthUser, ulbModel: Model<UlbDocument>, ulbId: unknown): Promise<boolean> {
  if (user.scope === Scope.ADMIN) return true;
  if (user.scope !== Scope.STATE) return false;
  const ulb = await loadUlbOwnership(ulbModel, ulbId);
  return !!ulb && canViewUlb(user, ulb);
}

/** canDecideUlb against the ULB's stored ownership. ADMIN needs no lookup; any non-STATE scope is false. */
export async function hasUlbDecideAccess(
  user: AuthUser,
  ulbModel: Model<UlbDocument>,
  ulbId: unknown,
): Promise<boolean> {
  if (user.scope === Scope.ADMIN) return true;
  if (user.scope !== Scope.STATE) return false;
  const ulb = await loadUlbOwnership(ulbModel, ulbId);
  return !!ulb && canDecideUlb(user, ulb);
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
