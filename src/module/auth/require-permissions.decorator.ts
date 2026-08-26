// src/common/auth/require-permissions.decorator.ts

import { SetMetadata } from '@nestjs/common';
import { Permission } from './enum/roles-xvi-fc.enum';

export const REQUIRED_PERMISSIONS_KEY = 'required_permissions';

export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
