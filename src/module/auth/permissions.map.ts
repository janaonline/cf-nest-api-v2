// src/common/auth/permissions.map.ts

import { AccessLevel, Permission } from './enum/roles-xvi-fc.enum';

export const ACCESS_LEVEL_PERMISSIONS: Record<AccessLevel, Permission[]> = {
  ADMIN: [
    Permission.VIEW_DATA,
    Permission.EDIT_DATA,
    Permission.SUBMIT_DATA,
    Permission.ADD_MEMBER,
    Permission.DELETE_MEMBER,
    Permission.APPROVE_DATA,
    Permission.CREATE_MANAGED_USER,
  ],

  EDITOR: [Permission.VIEW_DATA, Permission.EDIT_DATA],

  VIEWER: [Permission.VIEW_DATA],
};
