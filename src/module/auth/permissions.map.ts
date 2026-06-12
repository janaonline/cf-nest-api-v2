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
  [UserRole.ULB_VIEWER]: [
    Permission.VIEW_STATUS_REPORTS,
    Permission.VIEW_MANAGED_USERS,
  ],

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
    Permission.VIEW_MANAGED_USERS,
  ],

  // ── STATE Viewer ─────────────────────────────────────────────────────────
  [UserRole.STATE_VIEWER]: [
    Permission.VIEW_STATUS_REPORTS,
    Permission.VIEW_DASHBOARDS,
    Permission.VIEW_MANAGED_USERS,
  ],

  // ── Platform Admin (all permissions) ─────────────────────────────────────
  [UserRole.ADMIN]: Object.values(Permission),
};

/**
 * Derives the effective permission set for a user:
 * 1. Start with the role's default permissions from ROLE_PERMISSIONS.
 * 2. Union with permissionOverrides.allow (per-user grants).
 * 3. Subtract permissionOverrides.deny  (per-user revocations).
 */
export function getEffectivePermissions(user: {
  role: UserRole | string;
  permissionOverrides?: {
    allow?: Permission[];
    deny?: Permission[];
  };
}): Permission[] {
  const base: Permission[] = ROLE_PERMISSIONS[user.role as UserRole] ?? [];
  const allow: Permission[] = user.permissionOverrides?.allow ?? [];
  const deny = new Set<Permission>(user.permissionOverrides?.deny ?? []);

  const merged = [...new Set([...base, ...allow])];
  return merged.filter((p) => !deny.has(p));
}
