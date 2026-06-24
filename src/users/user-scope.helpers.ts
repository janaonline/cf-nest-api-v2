/* eslint-disable prettier/prettier */
/**
 * Scope and permission guard helpers for the Users domain.
 *
 * Three exported functions cover the three distinct scope-enforcement
 * patterns used across the service:
 *
 *   resolveAdminScopeTarget  – user creation  (admin check + role validation + ID resolution)
 *   assertAdminSameScope     – permission overrides  (admin check + same-ULB/state enforcement)
 *   buildScopedQuery         – list users  (all roles, locks query to requester's own scope)
 *
 * toObjectIdString is a shared low-level utility used by all three.
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { Role } from 'src/module/auth/enum/role.enum';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

// ─── Shared utility ────────────────────────────────────────────────────────

/**
 * Normalises the many shapes an ObjectId can arrive in (ObjectId instance,
 * plain string, or a populated sub-document with an _id field) into a
 * plain hex string, or null when the value is absent.
 */
export function toObjectIdString(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Types.ObjectId) return value.toString();

  if (typeof value === 'string') return value;

  if (typeof value === 'object' && value !== null && '_id' in value) {
    const id = (value as { _id?: unknown })._id;
    if (id instanceof Types.ObjectId) return id.toString();
    if (typeof id === 'string') return id;
  }

  return null;
}

// ─── 1. User creation ──────────────────────────────────────────────────────

export interface AdminScopeTarget {
  creatorId: string;
  targetStateId: string | null;
  targetUlbId: string | null;
}

/**
 * Used by createManagedUser.
 *
 * Validates that:
 *   - the creator is a ULB or STATE admin
 *   - the targetRole is NOT an admin-level role
 *   - the targetRole fits the creator's scope (ULB-EDITOR/VIEWER vs STATE-EDITOR/VIEWER)
 *   - any ULB/state IDs supplied in `hints` match the creator's own scope
 *
 * Returns { creatorId, targetStateId, targetUlbId } ready to use in the DB payload.
 */
export function resolveAdminScopeTarget(
  creator: AuthUser,
  targetRole: string,
  hints: { ulbId?: string; stateId?: string },
): AdminScopeTarget {
  const adminRoles = [Role.STATE, Role.ULB, Role.ADMIN] as string[];
  const stateManagedRoles = [Role.STATE, Role.STATE_EDITOR, Role.STATE_VIEWER] as string[];
  const ulbManagedRoles = [Role.ULB, Role.ULB_EDITOR, Role.ULB_VIEWER] as string[];

  if (!adminRoles.includes(creator.role)) {
    throw new ForbiddenException('Only ULB or STATE admin users can perform this action');
  }

  const creatorId = toObjectIdString(creator._id);
  if (!creatorId || !Types.ObjectId.isValid(creatorId)) {
    throw new ForbiddenException('Invalid logged-in user');
  }

  // Platform ADMIN can create any role in any scope using the provided hints
  if (creator.role === UserRole.ADMIN) {
    const targetStateId = hints.stateId ?? null;
    const targetUlbId   = hints.ulbId   ?? null;
    return { creatorId, targetStateId, targetUlbId };
  }

  // ULB/STATE admins cannot create a platform ADMIN
  if (targetRole === Role.ADMIN) {
    throw new ForbiddenException('Creating a platform ADMIN user is not permitted');
  }

  const creatorStateId = toObjectIdString(creator.state);
  const creatorUlbId   = toObjectIdString(creator.ulb);

  let targetStateId: string | null = null;
  let targetUlbId:   string | null = null;

  // ── STATE admin branch ────────────────────────────────────────────────────
  if (creator.role === UserRole.STATE) {
    if (!stateManagedRoles.includes(targetRole)) {
      throw new ForbiddenException('STATE admin can only assign STATE-EDITOR or STATE-VIEWER roles to managed users');
    }
    if (!creatorStateId || !Types.ObjectId.isValid(creatorStateId)) {
      throw new ForbiddenException('Logged-in STATE admin is not mapped to any valid state');
    }
    if (hints.stateId && !Types.ObjectId.isValid(hints.stateId)) {
      throw new BadRequestException('Invalid stateId');
    }
    if (hints.stateId && hints.stateId !== creatorStateId) {
      throw new ForbiddenException('You cannot perform this action for another state');
    }
    if (hints.ulbId) {
      throw new ForbiddenException('STATE admin cannot assign a ULB while managing STATE users');
    }
    targetStateId = creatorStateId;
  }

  // ── ULB admin branch ──────────────────────────────────────────────────────
  if (creator.role === UserRole.ULB) {
    if (!ulbManagedRoles.includes(targetRole)) {
      throw new ForbiddenException('ULB admin can only assign ULB, ULB-EDITOR or ULB-VIEWER role');
    }
    if (!creatorUlbId || !Types.ObjectId.isValid(creatorUlbId)) {
      throw new ForbiddenException('Logged-in ULB admin is not mapped to any valid ULB');
    }
    if (hints.ulbId && !Types.ObjectId.isValid(hints.ulbId)) {
      throw new BadRequestException('Invalid ulbId');
    }
    if (hints.ulbId && hints.ulbId !== creatorUlbId) {
      throw new ForbiddenException('You cannot perform this action for another ULB');
    }
    if (hints.stateId && creatorStateId && hints.stateId !== creatorStateId) {
      throw new ForbiddenException('You cannot perform this action for another state');
    }
    targetUlbId = creatorUlbId;
    if (creatorStateId && Types.ObjectId.isValid(creatorStateId)) {
      targetStateId = creatorStateId;
    }
  }

  return { creatorId, targetStateId, targetUlbId };
}

// ─── 2. Delete / role-update scope check ──────────────────────────────────

const ULB_MANAGEABLE_ROLES = [Role.ULB_EDITOR, Role.ULB_VIEWER] as string[];
const STATE_MANAGEABLE_ROLES = [Role.STATE_EDITOR, Role.STATE_VIEWER] as string[];

/**
 * Used by softDeleteUser and updateUserRole.
 *
 * Throws ForbiddenException unless:
 *   - requester is ULB or STATE admin (or platform ADMIN)
 *   - target user belongs to the requester's own ULB or state
 *   - target user's role is within the requester's manageable set
 *     (ULB admin → ULB-EDITOR / ULB-VIEWER only; STATE admin → STATE-EDITOR / STATE-VIEWER only)
 */
export function assertManageableTarget(
  requester: AuthUser,
  targetUser: { ulb?: unknown; state?: unknown; role?: unknown },
): void {
  if (requester.role === UserRole.ADMIN) return;

  if (requester.role !== UserRole.ULB && requester.role !== UserRole.STATE) {
    throw new ForbiddenException('Only ULB or STATE admin users can perform this action');
  }

  const targetRole = targetUser.role as string;

  if (requester.role === UserRole.ULB) {
    const requesterUlbId = toObjectIdString(requester.ulb);
    const targetUlbId    = toObjectIdString(targetUser.ulb);
    if (!requesterUlbId || requesterUlbId !== targetUlbId) {
      throw new ForbiddenException('You can only manage users within your own ULB');
    }
    if (!ULB_MANAGEABLE_ROLES.includes(targetRole)) {
      throw new ForbiddenException('ULB admin can only manage ULB-EDITOR and ULB-VIEWER users');
    }
  }

  if (requester.role === UserRole.STATE) {
    const requesterStateId = toObjectIdString(requester.state);
    const targetStateId    = toObjectIdString(targetUser.state);
    if (!requesterStateId || requesterStateId !== targetStateId) {
      throw new ForbiddenException('You can only manage users within your own state');
    }
    if (!STATE_MANAGEABLE_ROLES.includes(targetRole)) {
      throw new ForbiddenException('STATE admin can only manage STATE-EDITOR and STATE-VIEWER users');
    }
  }
}

// ─── 4. Permission overrides ───────────────────────────────────────────────

/**
 * Used by updatePermissionOverrides.
 *
 * Throws ForbiddenException unless:
 *   - requester is a ULB or STATE admin (not editor/viewer)
 *   - the target user belongs to the requester's own ULB or state
 */
export function assertAdminSameScope(
  requester: AuthUser,
  targetUser: { ulb?: unknown; state?: unknown },
): void {
  // Platform ADMIN has no scope restriction
  if (requester.role === UserRole.ADMIN) return;

  if (requester.role !== UserRole.ULB && requester.role !== UserRole.STATE) {
    throw new ForbiddenException('Only ULB or STATE admin users can override permissions');
  }

  if (requester.role === UserRole.ULB) {
    const requesterUlbId = toObjectIdString(requester.ulb);
    const targetUlbId    = toObjectIdString(targetUser.ulb);
    if (!requesterUlbId || requesterUlbId !== targetUlbId) {
      throw new ForbiddenException('You can only override permissions for users in your own ULB');
    }
  }

  if (requester.role === UserRole.STATE) {
    const requesterStateId = toObjectIdString(requester.state);
    const targetStateId    = toObjectIdString(targetUser.state);
    if (!requesterStateId || requesterStateId !== targetStateId) {
      throw new ForbiddenException('You can only override permissions for users in your own state');
    }
  }
}

// ─── 5. List users ─────────────────────────────────────────────────────────

/**
 * Locks the incoming query to the requester's own ULB or state.
 *
 * Edge cases enforced:
 *   - Both ulbId + stateId in the same request → 400
 *   - ULB-scope user querying a stateId → 403
 *   - STATE-scope user querying a ulbId → 403
 *   - ULB-scope user with no ULB mapping → 403
 *   - STATE-scope user with no state mapping → 403
 *   - Either scope querying a different ULB/state than their own → 403
 *   - ADMIN can query any ULB or state (must still provide one via the service-layer check)
 *   - Any other role (MoHUA, PMU, …) never reaches here — PermissionGuard blocks them
 */
export function buildScopedQuery(requester: AuthUser, query: ListUsersQueryDto): ListUsersQueryDto {
  if (query.ulbId && query.stateId) {
    throw new BadRequestException('Provide either ulbId or stateId, not both');
  }

  const requesterUlbId = toObjectIdString(requester.ulb);
  const requesterStateId = toObjectIdString(requester.state);

  if (requester.scope === Scope.ULB) {
    if (!requesterUlbId || !Types.ObjectId.isValid(requesterUlbId)) {
      throw new ForbiddenException('Your account is not mapped to any ULB');
    }
    if (query.stateId) {
      throw new ForbiddenException('ULB users cannot query a state-scoped user list');
    }
    if (query.ulbId && query.ulbId !== requesterUlbId) {
      throw new ForbiddenException('You can only view users within your own ULB');
    }
    // Always lock to requester's own ULB regardless of what was passed
    return { ulbId: requesterUlbId };
  }

  if (requester.scope === Scope.STATE) {
    if (!requesterStateId || !Types.ObjectId.isValid(requesterStateId)) {
      throw new ForbiddenException('Your account is not mapped to any state');
    }
    if (query.ulbId) {
      throw new ForbiddenException('STATE users cannot query a ULB-scoped user list');
    }
    if (query.stateId && query.stateId !== requesterStateId) {
      throw new ForbiddenException('You can only view users within your own state');
    }
    // Always lock to requester's own state regardless of what was passed
    return { stateId: requesterStateId };
  }

  if (requester.scope === Scope.ADMIN) {
    // ADMIN can query any ULB or state; service layer enforces that one must be provided
    return query;
  }

  // Any other role should have been rejected by PermissionGuard before reaching here
  throw new ForbiddenException('You do not have access to user listings');
}
