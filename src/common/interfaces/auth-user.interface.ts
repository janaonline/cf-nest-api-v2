import { Role } from '../../module/auth/enum/role.enum';

/**
 * Shape of the authenticated user extracted from the JWT by @CurrentUser().
 * ulb and state are ObjectId strings and only present for ULB / STATE users.
 */
export interface IAuthUser {
  _id: string;
  email?: string;
  role: Role;
  /** ObjectId string — present only for Role.ULB users */
  ulb?: string;
  /** ObjectId string — present only for Role.STATE users */
  state?: string;
  /** ObjectId string — set only for an ADC user (a Role.STATE user scoped to one Autonomous District Council) */
  adc?: string | null;
  xviFcSubrole?: 'admin' | 'reviewer' | 'viewer' | null;
  isActive?: boolean;
  jti?: string;
  exp?: number;
}
