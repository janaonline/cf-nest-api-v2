import { ExecutionContext, HttpException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const makeContext = (isPublic = false): ExecutionContext => ({
  getHandler: jest.fn().mockReturnValue({}),
  getClass: jest.fn().mockReturnValue({}),
  switchToHttp: jest.fn(),
} as any);

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as any;
    guard = new JwtAuthGuard(reflector);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should return true for public routes without calling super', () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const ctx = makeContext();
      const result = guard.canActivate(ctx);
      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
    });

    it('should call super.canActivate for non-public routes', () => {
      reflector.getAllAndOverride.mockReturnValue(false);
      const superSpy = jest
        .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
        .mockReturnValue(true);
      const ctx = makeContext();
      guard.canActivate(ctx);
      expect(superSpy).toHaveBeenCalledWith(ctx);
      superSpy.mockRestore();
    });
  });

  describe('handleRequest', () => {
    it('should return the user when no error and user present', () => {
      const user = { _id: 'user1', role: 'ADMIN' };
      const result = guard.handleRequest(null, user, null);
      expect(result).toEqual(user);
    });

    it('should throw HttpException with 401 for TokenExpiredError', () => {
      expect(() => guard.handleRequest(null, null, { name: 'TokenExpiredError' })).toThrow(
        new HttpException('Token expired', 401),
      );
    });

    it('should throw HttpException with 401 for JsonWebTokenError', () => {
      expect(() => guard.handleRequest(null, null, { name: 'JsonWebTokenError' })).toThrow(
        new HttpException('Invalid token', 401),
      );
    });

    it('should throw UnauthorizedException when user is falsy', () => {
      expect(() => guard.handleRequest(null, null, null)).toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when err is present', () => {
      expect(() => guard.handleRequest(new Error('auth failed'), null, null)).toThrow(
        UnauthorizedException,
      );
    });
  });
});
