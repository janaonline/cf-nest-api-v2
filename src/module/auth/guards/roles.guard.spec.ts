import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enum/role.enum';

const makeContext = (user: any, handler = {}, cls = {}): ExecutionContext =>
  ({
    getHandler: jest.fn().mockReturnValue(handler),
    getClass: jest.fn().mockReturnValue(cls),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue({ user }),
    }),
  } as any);

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as any;
    guard = new RolesGuard(reflector);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should return true for public routes', () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return true;
      return undefined;
    });
    const ctx = makeContext(null);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should return true when no roles are required', () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return [];
      return undefined;
    });
    const ctx = makeContext({ role: Role.ULB });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should return true when user has required role', () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return [Role.ADMIN];
      return undefined;
    });
    const ctx = makeContext({ role: Role.ADMIN });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw ForbiddenException when user role is missing', () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return [Role.ADMIN];
      return undefined;
    });
    const ctx = makeContext({ role: undefined });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('User role missing');
  });

  it('should throw ForbiddenException with insufficient permissions message', () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return [Role.ADMIN];
      return undefined;
    });
    const ctx = makeContext({ role: Role.ULB });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Insufficient permissions');
  });

  it('should return true when user has one of multiple required roles', () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return [Role.ADMIN, Role.STATE];
      return undefined;
    });
    const ctx = makeContext({ role: Role.STATE });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
