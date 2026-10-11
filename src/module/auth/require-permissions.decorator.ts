// src/common/auth/require-permissions.decorator.ts

import { SetMetadata } from '@nestjs/common';
import { Permission } from './enum/roles-xvi-fc.enum';

export const REQUIRED_PERMISSIONS_KEY = 'required_permissions';

export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

export const REQUIRED_ANY_PERMISSIONS_KEY = 'required_any_permissions';

/** Passes when the caller holds AT LEAST ONE of `permissions` (unlike `RequirePermissions`, which needs all). Pair with `AnyPermissionGuard`. */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_ANY_PERMISSIONS_KEY, permissions);
