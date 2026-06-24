// src/common/auth/roles.enum.ts
// roles for xvi financial commission module
export enum UserRole {
  ULB = 'ULB',
  ULB_EDITOR = 'ULB-EDITOR',
  ULB_VIEWER = 'ULB-VIEWER',

  STATE = 'STATE',
  STATE_EDITOR = 'STATE-EDITOR',
  STATE_VIEWER = 'STATE-VIEWER',

  ADMIN = 'ADMIN',
}

/**
 * The only roles that may be assigned to a managed (non-submitter) user.
 * Submitter-level roles (STATE, ULB) are granted only via profile-verification
 * or transfer-ownership — never through a direct role-assignment endpoint.
 *
 * This is the single source of truth referenced by DTOs, services, and helpers.
 */
export const MANAGED_ROLES = [
  UserRole.ULB_EDITOR,
  UserRole.ULB_VIEWER,
  UserRole.STATE_EDITOR,
  UserRole.STATE_VIEWER,
] as const;

export type ManagedRole = (typeof MANAGED_ROLES)[number];

export enum Scope {
  ULB = 'ULB',
  STATE = 'STATE',
  ADMIN = 'ADMIN',
}

export enum AccessLevel {
  ADMIN = 'ADMIN',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER',
}

export enum Permission {
  // Common read
  VIEW_STATUS_REPORTS = 'VIEW_STATUS_REPORTS',
  VIEW_DASHBOARDS = 'VIEW_DASHBOARDS',

  // ULB actions
  UPLOAD_DOCUMENTS = 'UPLOAD_DOCUMENTS',
  MESSAGE_USERS = 'MESSAGE_USERS',
  FINAL_SUBMIT_TO_STATE_DMA = 'FINAL_SUBMIT_TO_STATE_DMA',

  // STATE actions
  UPLOAD_STATE_LEVEL_DOCUMENTS = 'UPLOAD_STATE_LEVEL_DOCUMENTS',
  REVIEW_ULB_SUBMISSIONS = 'REVIEW_ULB_SUBMISSIONS',
  APPROVE_ULB_SUBMISSIONS = 'APPROVE_ULB_SUBMISSIONS',
  PREPARE_GRANT_LETTERS = 'PREPARE_GRANT_LETTERS',
  RECOMMEND_EXEMPTIONS = 'RECOMMEND_EXEMPTIONS',
  FINAL_SUBMIT_TO_MOHUA = 'FINAL_SUBMIT_TO_MOHUA',

  // State form actions
  VIEW_STATE_FORMS = 'VIEW_STATE_FORMS',
  EDIT_STATE_FORMS = 'EDIT_STATE_FORMS',
  FINAL_SUBMIT_STATE_FORMS = 'FINAL_SUBMIT_STATE_FORMS',

  // User management
  MANAGE_USERS = 'MANAGE_USERS',
  VIEW_MANAGED_USERS = 'VIEW_MANAGED_USERS',
  CREATE_MANAGED_USER = 'CREATE_MANAGED_USER',
  UPDATE_MANAGED_USER = 'UPDATE_MANAGED_USER',
  DELETE_MANAGED_USER = 'DELETE_MANAGED_USER',
}
