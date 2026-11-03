// src/common/auth/role.helper.ts

import { AccessLevel, Scope, UserRole } from './enum/roles-xvi-fc.enum';

const SUBROLE_TO_ACCESS_LEVEL: Record<string, AccessLevel> = {
  admin: AccessLevel.ADMIN,
  reviewer: AccessLevel.EDITOR,
  viewer: AccessLevel.VIEWER,
};

/**
 * ADC (Autonomous District Council) users are not a separate role: they are STATE-scope users with `adc` set.
 * `adc: null` is a normal State user.
 */
export function isAdcUser(user: { scope?: Scope | null; adc?: unknown } | null | undefined): boolean {
  return user?.scope === Scope.STATE && !!user.adc;
}

export function parseUserRole(
  role: UserRole,
  xviFcSubrole?: string | null,
): { scope: Scope; accessLevel: AccessLevel } | null {
  switch (role) {
    case UserRole.ULB:
      return {
        scope: Scope.ULB,
        accessLevel: SUBROLE_TO_ACCESS_LEVEL[xviFcSubrole ?? ''] ?? AccessLevel.ADMIN,
      };

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

    case UserRole.PMU:
      return {
        scope: Scope.PMU,
        accessLevel: SUBROLE_TO_ACCESS_LEVEL[xviFcSubrole ?? ''] ?? AccessLevel.VIEWER,
      };

    case UserRole.DOE:
      return {
        scope: Scope.DOE,
        accessLevel: SUBROLE_TO_ACCESS_LEVEL[xviFcSubrole ?? ''] ?? AccessLevel.VIEWER,
      };

    default:
      // Non-XVI-FC role (e.g. USER, XVIFC_STATE) — skip scope mapping.
      return null;
  }
}
