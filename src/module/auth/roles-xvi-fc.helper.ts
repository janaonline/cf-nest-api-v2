// src/common/auth/role.helper.ts

import { AccessLevel, Scope, UserRole } from './enum/roles-xvi-fc.enum';

const SUBROLE_TO_ACCESS_LEVEL: Record<string, AccessLevel> = {
  admin: AccessLevel.ADMIN,
  reviewer: AccessLevel.EDITOR,
  viewer: AccessLevel.VIEWER,
};

export function parseUserRole(
  role: UserRole,
  xviFcSubrole?: string | null,
): { scope: Scope; accessLevel: AccessLevel } | null {
  switch (role) {
    case UserRole.STATE:
      return {
        scope: Scope.STATE,
        accessLevel: SUBROLE_TO_ACCESS_LEVEL[xviFcSubrole ?? ''] ?? AccessLevel.VIEWER,
      };

    case UserRole.MoHUA:
      return {
        scope: Scope.MOHUA,
        accessLevel: SUBROLE_TO_ACCESS_LEVEL[xviFcSubrole ?? ''] ?? AccessLevel.VIEWER,
      };

    case UserRole.ADMIN:
      return { scope: Scope.ADMIN, accessLevel: AccessLevel.ADMIN };

    default:
      // Non-XVI-FC role (e.g. PMU, USER, XVIFC) — skip scope mapping.
      return null;
  }
}
