// src/common/auth/roles.enum.ts
// roles for xvi financial commission module
export enum UserRole {
  ULB = 'ULB',
  ULB_EDITOR = 'ULB-EDITOR',
  ULB_VIEWER = 'ULB-VIEWER',

  STATE = 'STATE',
  STATE_EDITOR = 'STATE-EDITOR',
  STATE_VIEWER = 'STATE-VIEWER',
}

export enum Scope {
  ULB = 'ULB',
  STATE = 'STATE',
}

export enum AccessLevel {
  ADMIN = 'ADMIN',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER',
}

export enum Permission {
  VIEW_DATA = 'VIEW_DATA',
  EDIT_DATA = 'EDIT_DATA',
  SUBMIT_DATA = 'SUBMIT_DATA',
  ADD_MEMBER = 'ADD_MEMBER',
  DELETE_MEMBER = 'DELETE_MEMBER',
  APPROVE_DATA = 'APPROVE_DATA',
  CREATE_MANAGED_USER = 'CREATE_MANAGED_USER',
}
