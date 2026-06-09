import { AccessLevel, Permission, Scope, UserRole } from './enum/roles-xvi-fc.enum';
import { Types } from 'mongoose';

export interface AuthUser {
  _id: string;
  /** Raw role string from the DB — may be any value from role.enum.ts or roles-xvi-fc.enum.ts */
  role: string;
  /** Derived from role at validate() time — null for non-XVI-FC roles (MoHUA, PMU, etc.) */
  scope: Scope | null;
  /** Derived from role at validate() time — null for non-XVI-FC roles */
  accessLevel: AccessLevel | null;
  ulb?: Types.ObjectId | string | null;
  state?: Types.ObjectId | string | null;
  isActive?: boolean;
  sessionId?: string;
  exp?: number;
  permissionOverrides?: {
    allow: Permission[];
    deny: Permission[];
  };
}
