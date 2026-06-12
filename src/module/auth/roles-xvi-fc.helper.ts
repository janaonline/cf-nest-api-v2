// src/common/auth/role.helper.ts

import { AccessLevel, Scope, UserRole } from './enum/roles-xvi-fc.enum';

export function parseUserRole(role: UserRole): {
  scope: Scope;
  accessLevel: AccessLevel;
} | null {
  switch (role) {
    case UserRole.ULB:
      return {
        scope: Scope.ULB,
        accessLevel: AccessLevel.ADMIN,
      };

    case UserRole.ULB_EDITOR:
      return {
        scope: Scope.ULB,
        accessLevel: AccessLevel.EDITOR,
      };

    case UserRole.ULB_VIEWER:
      return {
        scope: Scope.ULB,
        accessLevel: AccessLevel.VIEWER,
      };

    case UserRole.STATE:
      return {
        scope: Scope.STATE,
        accessLevel: AccessLevel.ADMIN,
      };

    case UserRole.STATE_EDITOR:
      return {
        scope: Scope.STATE,
        accessLevel: AccessLevel.EDITOR,
      };

    case UserRole.STATE_VIEWER:
      return {
        scope: Scope.STATE,
        accessLevel: AccessLevel.VIEWER,
      };

    case UserRole.ADMIN:
      return {
        scope: Scope.ADMIN,
        accessLevel: AccessLevel.ADMIN,
      };

    default:
      // Non-XVI-FC role (e.g. MoHUA, PMU, USER, XVIFC) — skip scope mapping,
      // token is still issued with just role + sub.
      return null;
  }
}
