import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AnyPermissionGuard } from './any-permission.guard';
import { Permission, Scope, UserRole } from './enum/roles-xvi-fc.enum';

const makeContext = (user: unknown): ExecutionContext =>
  ({
    getHandler: jest.fn().mockReturnValue({}),
    getClass: jest.fn().mockReturnValue({}),
    switchToHttp: jest.fn().mockReturnValue({ getRequest: jest.fn().mockReturnValue({ user }) }),
  }) as unknown as ExecutionContext;

describe('AnyPermissionGuard', () => {
  let guard: AnyPermissionGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<Reflector>;
    guard = new AnyPermissionGuard(reflector);
  });

  it('passes when no permissions are declared', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(makeContext(null))).toBe(true);
  });

  it('rejects a user without a role', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.REVIEW_STATE_SUBMISSIONS_PMU]);
    expect(() => guard.canActivate(makeContext({}))).toThrow(ForbiddenException);
  });

  it('rejects a user holding none of the listed permissions', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.REVIEW_STATE_SUBMISSIONS_PMU]);
    expect(() => guard.canActivate(makeContext({ role: UserRole.ULB, scope: Scope.ULB }))).toThrow(ForbiddenException);
  });

  it('passes an admin (holds every permission)', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.REVIEW_STATE_SUBMISSIONS_PMU]);
    expect(guard.canActivate(makeContext({ role: UserRole.ADMIN }))).toBe(true);
  });
});
