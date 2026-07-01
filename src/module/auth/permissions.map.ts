/* eslint-disable prettier/prettier */
// src/module/auth/permissions.map.ts

import { Scope, UserRole, Permission } from './enum/roles-xvi-fc.enum';
import { XviFcSubrole } from './auth-user.interface';

// ─── XVI-FC STATE subrole permissions ─────────────────────────────────────────

export const XVIFC_STATE_PERMISSIONS: Record<XviFcSubrole, Permission[]> = {
  admin: [
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
  reviewer: [
    Permission.VIEW_STATUS_REPORTS,
    Permission.VIEW_DASHBOARDS,
    Permission.UPLOAD_STATE_LEVEL_DOCUMENTS,
    Permission.REVIEW_ULB_SUBMISSIONS,
    Permission.MESSAGE_USERS,
    Permission.APPROVE_ULB_SUBMISSIONS,
    Permission.PREPARE_GRANT_LETTERS,
    Permission.RECOMMEND_EXEMPTIONS,
    Permission.VIEW_STATE_FORMS,
    Permission.EDIT_STATE_FORMS,
    Permission.VIEW_MANAGED_USERS,
  ],
  viewer: [
    Permission.VIEW_STATUS_REPORTS,
    Permission.VIEW_DASHBOARDS,
    Permission.VIEW_STATE_FORMS,
    Permission.VIEW_MANAGED_USERS,
  ],
};

/**
 * Derives the effective permission set for a user:
 * 1. ADMIN role       → all permissions.
 * 2. STATE role       → XVIFC_STATE_PERMISSIONS[xviFcSubrole] (defaults to 'viewer' when unset).
 * 3. ULB role         → pending; returns [] until XVIFC_ULB_PERMISSIONS is implemented.
 * 4. Any other role   → no permissions (guard blocks the request).
 * 5. Union permissionOverrides.allow, subtract permissionOverrides.deny.
 */
export function getEffectivePermissions(user: {
  role: UserRole | string;
  scope?: Scope | null;
  xviFcSubrole?: string | null;
  permissionOverrides?: {
    allow?: Permission[];
    deny?: Permission[];
  };
}): Permission[] {
  let base: Permission[];

  const subrole = (user.xviFcSubrole as XviFcSubrole | null | undefined) ?? 'viewer';

  if (user.role === UserRole.ADMIN) {
    base = Object.values(Permission);
  } else if (user.role === UserRole.STATE || user.scope === Scope.STATE) {
    base = XVIFC_STATE_PERMISSIONS[subrole] ?? XVIFC_STATE_PERMISSIONS.viewer;
  } else {
    // ULB permission matrix is not yet implemented — ULB users carry no permissions until added.
    base = [];
  }

  const allow: Permission[] = user.permissionOverrides?.allow ?? [];
  const deny = new Set<Permission>(user.permissionOverrides?.deny ?? []);

  const merged = [...new Set([...base, ...allow])];
  return merged.filter((p) => !deny.has(p));
}
