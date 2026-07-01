import { AccessLevel, Permission, Scope } from './enum/roles-xvi-fc.enum';
import { Types } from 'mongoose';

export type XviFcSubrole = 'admin' | 'reviewer' | 'viewer';

export interface AuthUser {
  _id: string;
  role: string;
  scope: Scope | null;
  accessLevel: AccessLevel | null;
  xviFcSubrole?: XviFcSubrole | null;
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
