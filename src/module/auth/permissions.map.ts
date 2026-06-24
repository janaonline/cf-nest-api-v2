/* eslint-disable prettier/prettier */
// src/module/auth/permissions.map.ts

import { UserRole, Permission } from './enum/roles-xvi-fc.enum';

/**
 * Central role → permission matrix.
 * All default access is derived from here — users do NOT store a permissions
 * array directly. Only optional per-user adjustments are stored as
 * permissionOverrides.allow / permissionOverrides.deny on the user document.
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  // ── ULB Submitter (admin-level for ULB) ──────────────────────────────────
  [UserRole.ULB]: [
    Permission.VIEW_STATUS_REPORTS,
    Permission.UPLOAD_DOCUMENTS,
    Permission.MESSAGE_USERS,
    Permission.FINAL_SUBMIT_TO_STATE_DMA,
    Permission.MANAGE_USERS,
    Permission.VIEW_MANAGED_USERS,
    Permission.CREATE_MANAGED_USER,
    Permission.UPDATE_MANAGED_USER,
    Permission.DELETE_MANAGED_USER,
  ],

  // ── ULB Editor ───────────────────────────────────────────────────────────
  [UserRole.ULB_EDITOR]: [
    Permission.VIEW_STATUS_REPORTS,
    Permission.UPLOAD_DOCUMENTS,
    Permission.MESSAGE_USERS,
    Permission.VIEW_MANAGED_USERS,
  ],

  // ── ULB Viewer ───────────────────────────────────────────────────────────
  [UserRole.ULB_VIEWER]: [Permission.VIEW_STATUS_REPORTS, Permission.VIEW_MANAGED_USERS],

  // ── STATE Submitter (admin-level for STATE) ───────────────────────────────
  [UserRole.STATE]: [
    Permission.VIEW_STATUS_REPORTS,
    Permission.VIEW_DASHBOARDS,
    Permission.UPLOAD_STATE_LEVEL_DOCUMENTS,
    Permission.REVIEW_ULB_SUBMISSIONS,
    Permission.MESSAGE_USERS,
    Permission.APPROVE_ULB_SUBMISSIONS,
    Permission.PREPARE_GRANT_LETTERS,
    Permission.RECOMMEND_EXEMPTIONS,
    Permission.FINAL_SUBMIT_TO_MOHUA,
    Permission.VIEW_STATE_FORMS,
    Permission.EDIT_STATE_FORMS,
    Permission.FINAL_SUBMIT_STATE_FORMS,
    Permission.MANAGE_USERS,
    Permission.VIEW_MANAGED_USERS,
    Permission.CREATE_MANAGED_USER,
    Permission.UPDATE_MANAGED_USER,
    Permission.DELETE_MANAGED_USER,
  ],

  // ── STATE Editor ─────────────────────────────────────────────────────────
  [UserRole.STATE_EDITOR]: [
    Permission.VIEW_STATUS_REPORTS,
    Permission.VIEW_DASHBOARDS,
    Permission.UPLOAD_STATE_LEVEL_DOCUMENTS,
    Permission.REVIEW_ULB_SUBMISSIONS,
    Permission.MESSAGE_USERS,
    Permission.VIEW_STATE_FORMS,
    Permission.EDIT_STATE_FORMS,
    Permission.VIEW_MANAGED_USERS,
  ],

  // ── STATE Viewer ─────────────────────────────────────────────────────────
  [UserRole.STATE_VIEWER]: [
    Permission.VIEW_STATUS_REPORTS,
    Permission.VIEW_DASHBOARDS,
    Permission.VIEW_STATE_FORMS,
    Permission.VIEW_MANAGED_USERS,
  ],

  // ── Platform Admin (all permissions) ─────────────────────────────────────
  [UserRole.ADMIN]: Object.values(Permission),
};

/**
 * Maps a (role, subRole) pair to the capping UserRole whose permission set
 * should be used as the upper bound.
 *
 * Only applies when role is a "legacy" full-access role (STATE, ULB) and
 * subRole is 'editor' or 'viewer'. Managed users (STATE-EDITOR, ULB-VIEWER…)
 * are already capped by their role — subRole is redundant for them.
 */
function resolveSubRoleCap(role: string, subRole: string): UserRole | null {
  const r = role.toUpperCase();
  const isState = r === 'STATE';
  const isUlb = r === 'ULB';
  if (!isState && !isUlb) return null; // managed users already have correct role
  if (subRole === 'editor') return isState ? UserRole.STATE_EDITOR : UserRole.ULB_EDITOR;
  if (subRole === 'viewer') return isState ? UserRole.STATE_VIEWER : UserRole.ULB_VIEWER;
  return null;
}

/**
 * Derives the effective permission set for a user:
 * 1. Start with the role's default permissions from ROLE_PERMISSIONS.
 * 2. If subRole is 'editor' or 'viewer' on a legacy full-access account,
 *    intersect with the corresponding capped permission set (e.g. STATE + editor → STATE_EDITOR).
 * 3. Union with permissionOverrides.allow (per-user grants).
 * 4. Subtract permissionOverrides.deny  (per-user revocations).
 */
export function getEffectivePermissions(user: {
  role: UserRole | string;
  subRole?: 'submitter' | 'editor' | 'viewer' | null;
  permissionOverrides?: {
    allow?: Permission[];
    deny?: Permission[];
  };
}): Permission[] {
  const base: Permission[] = ROLE_PERMISSIONS[user.role as UserRole] ?? [];

  let capped = base;
  if (user.subRole && user.subRole !== 'submitter') {
    const capRole = resolveSubRoleCap(user.role as string, user.subRole);
    if (capRole) {
      const cap = new Set(ROLE_PERMISSIONS[capRole] ?? []);
      capped = base.filter((p) => cap.has(p));
    }
  }

  const allow: Permission[] = user.permissionOverrides?.allow ?? [];
  const deny = new Set<Permission>(user.permissionOverrides?.deny ?? []);

  const merged = [...new Set([...capped, ...allow])];
  return merged.filter((p) => !deny.has(p));
}
