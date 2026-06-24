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
  /**
   * Portal-level designation — fetched fresh from DB on every request by JwtStrategy.
   * Acts as a cap on permissions: a legacy STATE user with subRole 'editor' is capped
   * at STATE-EDITOR permissions even though their role field is STATE.
   * Never stored in the JWT payload itself.
   */
  subRole?: 'submitter' | 'editor' | 'viewer' | null;
}
