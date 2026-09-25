import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { REQUIRED_PERMISSIONS_KEY } from './require-permissions.decorator';
import { Permission, UserRole } from './enum/roles-xvi-fc.enum';

const makeContext = (user: unknown, handler = {}, cls = {}): ExecutionContext =>
  ({
    getHandler: jest.fn().mockReturnValue(handler),
    getClass: jest.fn().mockReturnValue(cls),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue({ user }),
    }),
  }) as unknown as ExecutionContext;

describe('PermissionGuard', () => {
  let guard: PermissionGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<Reflector>;
    guard = new PermissionGuard(reflector);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('returns true when no permissions are required (metadata is an empty array)', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    const ctx = makeContext(null);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('returns true when no permissions are required (metadata is undefined)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = makeContext(null);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('reads required permissions via getAllAndOverride from handler and class', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    const handler = { name: 'handler' };
    const cls = { name: 'cls' };
    const ctx = makeContext(null, handler, cls);

    guard.canActivate(ctx);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(REQUIRED_PERMISSIONS_KEY, [handler, cls]);
  });

  it('throws ForbiddenException("User role not found") when the request has no user', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.VIEW_DASHBOARDS]);
    const ctx = makeContext(undefined);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('User role not found');
  });

  it('throws ForbiddenException("User role not found") when the user has no role', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.VIEW_DASHBOARDS]);
    const ctx = makeContext({ role: undefined });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('User role not found');
  });

  it('returns true for an ADMIN user regardless of the permissions required (ADMIN has all)', () => {
    reflector.getAllAndOverride.mockReturnValue([
      Permission.MANAGE_USERS,
      Permission.FINAL_SUBMIT_TO_DOE,
    ]);
    const ctx = makeContext({ role: UserRole.ADMIN });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('returns true when a STATE admin subrole has all required permissions', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.APPROVE_ULB_SUBMISSIONS]);
    const ctx = makeContext({ role: UserRole.STATE, xviFcSubrole: 'admin' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when a STATE viewer lacks the required permission', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.APPROVE_ULB_SUBMISSIONS]);
    const ctx = makeContext({ role: UserRole.STATE, xviFcSubrole: 'viewer' });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('You do not have permission to perform this action');
  });

  it('defaults an unset xviFcSubrole to viewer permissions', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.VIEW_STATE_FORMS]);
    const ctx = makeContext({ role: UserRole.STATE });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('requires every listed permission, not just one (STATE reviewer misses MANAGE_USERS)', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.REVIEW_ULB_SUBMISSIONS, Permission.MANAGE_USERS]);
    const ctx = makeContext({ role: UserRole.STATE, xviFcSubrole: 'reviewer' });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('returns true for a MoHUA reviewer with the required permission', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.REQUEST_INFO_FROM_STATES]);
    const ctx = makeContext({ role: UserRole.MoHUA, xviFcSubrole: 'reviewer' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException for a ULB user (permission matrix not yet implemented → no permissions)', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.VIEW_STATUS_REPORTS]);
    const ctx = makeContext({ role: UserRole.ULB });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('grants access via permissionOverrides.allow even when the base role lacks it', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.MANAGE_USERS]);
    const ctx = makeContext({
      role: UserRole.STATE,
      xviFcSubrole: 'viewer',
      permissionOverrides: { allow: [Permission.MANAGE_USERS] },
    });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('revokes access via permissionOverrides.deny even for an ADMIN', () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.MANAGE_USERS]);
    const ctx = makeContext({
      role: UserRole.ADMIN,
      permissionOverrides: { deny: [Permission.MANAGE_USERS] },
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
