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
    Permission.FINAL_SUBMIT_TO_MOHUA,
    Permission.VIEW_STATE_FORMS,
    Permission.EDIT_STATE_FORMS,
    Permission.FINAL_SUBMIT_STATE_FORMS,
  ],
  viewer: [Permission.VIEW_STATUS_REPORTS, Permission.VIEW_DASHBOARDS, Permission.VIEW_STATE_FORMS],
};

// ─── XVI-FC MoHUA subrole permissions ─────────────────────────────────────────

// REVIEW_STATE_SUBMISSIONS_PMU gives every MoHUA subrole READ access to the PMU review GETs (state forms, view only).
// Approve/reject need APPROVE_STATE_SUBMISSIONS_PMU, which MoHUA never holds, so its review permissions
// come back canApprove/canReject = false.
export const XVIFC_MOHUA_PERMISSIONS: Record<XviFcSubrole, Permission[]> = {
  admin: [
    Permission.VIEW_STATUS_REPORTS,
    Permission.VIEW_DASHBOARDS,
    Permission.REVIEW_STATE_SUBMISSIONS_PMU,
    Permission.REVIEW_STATE_SUBMISSIONS,
    Permission.SEND_REMINDERS_TO_STATES,
    Permission.REQUEST_INFO_FROM_STATES,
    Permission.APPROVE_STATE_SUBMISSIONS,
    Permission.ISSUE_OFFICE_MEMORANDUM,
    Permission.FINAL_SUBMIT_TO_DOE,
    Permission.MANAGE_USERS,
    Permission.VIEW_MANAGED_USERS,
    Permission.CREATE_MANAGED_USER,
    Permission.UPDATE_MANAGED_USER,
    Permission.DELETE_MANAGED_USER,
  ],
  reviewer: [
    Permission.VIEW_STATUS_REPORTS,
    Permission.VIEW_DASHBOARDS,
    Permission.REVIEW_STATE_SUBMISSIONS_PMU,
    Permission.REVIEW_STATE_SUBMISSIONS,
    Permission.SEND_REMINDERS_TO_STATES,
    Permission.REQUEST_INFO_FROM_STATES,
  ],
  viewer: [Permission.VIEW_STATUS_REPORTS, Permission.VIEW_DASHBOARDS, Permission.REVIEW_STATE_SUBMISSIONS_PMU],
};

// ─── XVI-FC PMU subrole permissions (PMU Review feature) ──────────────────────

export const XVIFC_PMU_PERMISSIONS: Record<XviFcSubrole, Permission[]> = {
  admin: [
    Permission.VIEW_STATUS_REPORTS,
    Permission.VIEW_DASHBOARDS,
    Permission.REVIEW_STATE_SUBMISSIONS_PMU,
    Permission.APPROVE_STATE_SUBMISSIONS_PMU,
    Permission.MANAGE_USERS,
    Permission.VIEW_MANAGED_USERS,
    Permission.CREATE_MANAGED_USER,
    Permission.UPDATE_MANAGED_USER,
    Permission.DELETE_MANAGED_USER,
  ],
  reviewer: [Permission.VIEW_STATUS_REPORTS, Permission.VIEW_DASHBOARDS, Permission.REVIEW_STATE_SUBMISSIONS_PMU],
  // REVIEW_STATE_SUBMISSIONS_PMU is the read gate for the PMU review GETs — a viewer may open the forms but
  // never decide them (approve/reject need APPROVE_STATE_SUBMISSIONS_PMU, held by admin only).
  viewer: [Permission.VIEW_STATUS_REPORTS, Permission.VIEW_DASHBOARDS, Permission.REVIEW_STATE_SUBMISSIONS_PMU],
};

// ─── XVI-FC DoE subrole permissions (read-only copy of the MoHUA dashboard) ───

// Every DoE subrole is view-only. REVIEW_STATE_SUBMISSIONS_PMU is only the read gate for the read-only form
// screens (same as MoHUA) — DoE never holds an approve/decide permission, and DoeReadOnlyGuard rejects every
// non-GET request for DoE except team management and its own profile (see doe-read-only.guard.ts).
const DOE_VIEW_PERMISSIONS: Permission[] = [
  Permission.VIEW_STATUS_REPORTS,
  Permission.VIEW_DASHBOARDS,
  Permission.REVIEW_STATE_SUBMISSIONS_PMU,
];

export const XVIFC_DOE_PERMISSIONS: Record<XviFcSubrole, Permission[]> = {
  admin: [
    ...DOE_VIEW_PERMISSIONS,
    Permission.MANAGE_USERS,
    Permission.VIEW_MANAGED_USERS,
    Permission.CREATE_MANAGED_USER,
    Permission.UPDATE_MANAGED_USER,
    Permission.DELETE_MANAGED_USER,
  ],
  reviewer: DOE_VIEW_PERMISSIONS,
  viewer: DOE_VIEW_PERMISSIONS,
};

/**
 * Derives the effective permission set for a user:
 * 1. ADMIN role  → all permissions.
 * 2. STATE role  → XVIFC_STATE_PERMISSIONS[xviFcSubrole] (defaults to 'viewer' when unset).
 * 3. MoHUA role  → XVIFC_MOHUA_PERMISSIONS[xviFcSubrole] (defaults to 'viewer' when unset).
 * 4. PMU role    → XVIFC_PMU_PERMISSIONS[xviFcSubrole] (defaults to 'viewer' when unset).
 * 5. DoE role    → XVIFC_DOE_PERMISSIONS[xviFcSubrole] (defaults to 'viewer' when unset).
 * 6. ULB role    → pending; returns [] until XVIFC_ULB_PERMISSIONS is implemented.
 * 7. Other roles → no permissions (guard blocks the request).
 * 8. Union permissionOverrides.allow, subtract permissionOverrides.deny.
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
  } else if (user.role === UserRole.MoHUA || user.scope === Scope.MOHUA) {
    base = XVIFC_MOHUA_PERMISSIONS[subrole] ?? XVIFC_MOHUA_PERMISSIONS.viewer;
  } else if (user.role === UserRole.PMU || user.scope === Scope.PMU) {
    base = XVIFC_PMU_PERMISSIONS[subrole] ?? XVIFC_PMU_PERMISSIONS.viewer;
  } else if (user.role === UserRole.DOE || user.scope === Scope.DOE) {
    base = XVIFC_DOE_PERMISSIONS[subrole] ?? XVIFC_DOE_PERMISSIONS.viewer;
  } else {
    // ULB permission matrix is not yet implemented — ULB users carry no permissions until added.
    base = [];
  }

  const allow: Permission[] = user.permissionOverrides?.allow ?? [];
  const deny = new Set<Permission>(user.permissionOverrides?.deny ?? []);

  const merged = [...new Set([...base, ...allow])];
  return merged.filter((p) => !deny.has(p));
}
