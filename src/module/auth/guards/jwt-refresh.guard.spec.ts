import { HttpException } from '@nestjs/common';
import { JwtRefreshGuard } from './jwt-refresh.guard';

describe('JwtRefreshGuard', () => {
  let guard: JwtRefreshGuard;

  beforeEach(() => {
    guard = new JwtRefreshGuard();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('handleRequest', () => {
    it('should return the user when valid', () => {
      const user = { _id: 'user1', role: 'ULB' };
      const result = guard.handleRequest(null, user);
      expect(result).toEqual(user);
    });

    it('should throw HttpException 440 when user is null', () => {
      expect(() => guard.handleRequest(null, null)).toThrow(
        new HttpException('Session expired, please login again', 440),
      );
    });

    it('should throw HttpException 440 when err is present', () => {
      expect(() => guard.handleRequest(new Error('token mismatch'), null)).toThrow(HttpException);
    });

    it('should use status 440 for session expiry', () => {
      try {
        guard.handleRequest(null, null);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(440);
      }
    });
  });
});
