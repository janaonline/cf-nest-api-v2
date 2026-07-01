import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

// ─── Shared utility ────────────────────────────────────────────────────────

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

// ─── List users ────────────────────────────────────────────────────────────

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
    return { stateId: requesterStateId };
  }

  if (requester.scope === Scope.ADMIN) {
    return query;
  }

  throw new ForbiddenException('You do not have access to user listings');
}
