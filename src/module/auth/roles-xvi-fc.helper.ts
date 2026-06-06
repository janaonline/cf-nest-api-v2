/* eslint-disable @typescript-eslint/restrict-template-expressions */
// src/common/auth/role.helper.ts

import { AccessLevel, Scope, UserRole } from './enum/roles-xvi-fc.enum';

export function parseUserRole(role: UserRole): {
  scope: Scope;
  accessLevel: AccessLevel;
} {
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

    default:
      throw new Error(`Unsupported role: ${role}`);
  }
}
