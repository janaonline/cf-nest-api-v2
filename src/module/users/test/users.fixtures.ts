/**
 * Shared test doubles / builders for src/module/users/*.spec.ts.
 *
 * This file did not exist previously — users.service.spec.ts imported it but it had
 * never been committed, which (along with stale schema import paths) was one of the
 * reasons that spec could never run.
 */
import { Types } from 'mongoose';
import { Role } from 'src/module/auth/enum/role.enum';
import { AccessLevel, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import type { UpdatePermissionOverridesDto } from '../dto/update-permission-overrides.dto';

// ─── Fixed ids reused across tests ─────────────────────────────────────────

export const ULB_ID = new Types.ObjectId().toString();
export const ULB_ID_2 = new Types.ObjectId().toString();
export const STATE_ID = new Types.ObjectId().toString();
export const STATE_ID_2 = new Types.ObjectId().toString();
export const TARGET_USER_ID = new Types.ObjectId().toString();

// ─── Mongoose model chain mock ─────────────────────────────────────────────

/**
 * Builds a jest mock that stands in for a Mongoose Model. Every query-builder
 * method (find, findOne, select, lean, populate, ...) returns the same mock so
 * calls can be chained the way the real API does; `.exec()` is the terminal
 * call and is what tests configure with mockResolvedValue/mockRejectedValue.
 */
export function createChainMock() {
  const mock: Record<string, jest.Mock> = {} as Record<string, jest.Mock>;

  const chainable = [
    'find',
    'findOne',
    'findById',
    'findByIdAndUpdate',
    'findByIdAndDelete',
    'findOneAndUpdate',
    'updateMany',
    'select',
    'lean',
    'populate',
    'sort',
    'limit',
    'skip',
  ];

  chainable.forEach((method) => {
    mock[method] = jest.fn().mockReturnValue(mock);
  });

  mock.exec = jest.fn();
  mock.create = jest.fn();
  mock.exists = jest.fn();
  (mock as unknown as { db: unknown }).db = {
    collection: jest.fn().mockReturnValue({ findOne: jest.fn() }),
  };

  return mock as typeof mock & {
    exec: jest.Mock;
    create: jest.Mock;
    exists: jest.Mock;
    db: { collection: jest.Mock };
  };
}

// ─── AuthUser builders ──────────────────────────────────────────────────────

function baseAuthUser(overrides: Partial<AuthUser>): AuthUser {
  return {
    _id: new Types.ObjectId().toString(),
    role: Role.ULB,
    scope: Scope.ULB,
    accessLevel: AccessLevel.ADMIN,
    xviFcSubrole: null,
    ulb: undefined,
    state: undefined,
    isActive: true,
    ...overrides,
  };
}

export function makeUlbAdmin(overrides: Partial<AuthUser> = {}): AuthUser {
  return baseAuthUser({
    role: Role.ULB,
    scope: Scope.ULB,
    accessLevel: AccessLevel.ADMIN,
    ulb: new Types.ObjectId(ULB_ID),
    ...overrides,
  });
}

export function makeUlbEditor(overrides: Partial<AuthUser> = {}): AuthUser {
  return baseAuthUser({
    role: Role.ULB_EDITOR,
    scope: Scope.ULB,
    accessLevel: AccessLevel.EDITOR,
    ulb: new Types.ObjectId(ULB_ID),
    ...overrides,
  });
}

export function makeUlbViewer(overrides: Partial<AuthUser> = {}): AuthUser {
  return baseAuthUser({
    role: Role.ULB_VIEWER,
    scope: Scope.ULB,
    accessLevel: AccessLevel.VIEWER,
    ulb: new Types.ObjectId(ULB_ID),
    ...overrides,
  });
}

export function makeStateAdmin(overrides: Partial<AuthUser> = {}): AuthUser {
  return baseAuthUser({
    role: Role.STATE,
    scope: Scope.STATE,
    accessLevel: AccessLevel.ADMIN,
    xviFcSubrole: 'admin',
    state: new Types.ObjectId(STATE_ID),
    ...overrides,
  });
}

export function makeStateEditor(overrides: Partial<AuthUser> = {}): AuthUser {
  return baseAuthUser({
    role: Role.STATE_EDITOR,
    scope: Scope.STATE,
    accessLevel: AccessLevel.EDITOR,
    xviFcSubrole: 'reviewer',
    state: new Types.ObjectId(STATE_ID),
    ...overrides,
  });
}

export function makeStateViewer(overrides: Partial<AuthUser> = {}): AuthUser {
  return baseAuthUser({
    role: Role.STATE_VIEWER,
    scope: Scope.STATE,
    accessLevel: AccessLevel.VIEWER,
    xviFcSubrole: 'viewer',
    state: new Types.ObjectId(STATE_ID),
    ...overrides,
  });
}

export function makeMohuaAdmin(overrides: Partial<AuthUser> = {}): AuthUser {
  return baseAuthUser({
    role: Role.MoHUA,
    scope: Scope.MOHUA,
    accessLevel: AccessLevel.ADMIN,
    xviFcSubrole: 'admin',
    ...overrides,
  });
}

// ─── DTO / document builders ────────────────────────────────────────────────

export function makeOverridesDto(
  overrides: Partial<UpdatePermissionOverridesDto> = {},
): UpdatePermissionOverridesDto {
  return { allow: [], deny: [], ...overrides };
}

export function makeUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(TARGET_USER_ID),
    name: 'Target User',
    email: 'target@example.com',
    role: Role.ULB,
    ulb: new Types.ObjectId(ULB_ID),
    state: undefined,
    xviFcSubrole: null,
    isActive: true,
    isDeleted: false,
    ...overrides,
  };
}
