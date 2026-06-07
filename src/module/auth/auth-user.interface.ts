import { AccessLevel, Permission, Scope, UserRole } from './enum/roles-xvi-fc.enum';
import { Types } from 'mongoose';

export interface AuthUser {
  _id: string;
  role: UserRole;
  scope: Scope;
  accessLevel: AccessLevel;
  ulb?: Types.ObjectId | string | null;
  state?: Types.ObjectId | string | null;
  isActive?: boolean;
  jti?: string;
  exp?: number;
  /** Per-user permission overrides loaded from the user document at JWT validation time. */
  permissionOverrides?: {
    allow: Permission[];
    deny: Permission[];
  };
}
