import { ExecutionContext, HttpException } from '@nestjs/common';
import { ThrottlerBehindProxyGuard } from './throttler-behind-proxy.guard';

describe('ThrottlerBehindProxyGuard', () => {
  let guard: ThrottlerBehindProxyGuard;

  beforeEach(() => {
    // Provide all constructor args required by ThrottlerGuard
    guard = new ThrottlerBehindProxyGuard(
      [{ ttl: 60000, limit: 60 }],
      { isThrottled: jest.fn() } as any,
      { get: jest.fn() } as any,
    );
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('getTracker', () => {
    it('should use the first IP from x-forwarded-for header when present', async () => {
      const req = {
        headers: { 'x-forwarded-for': '203.0.113.10, 70.41.3.18, 150.172.238.178' },
        ip: '127.0.0.1',
      };

      const tracker = await (guard as any).getTracker(req);

      expect(tracker).toBe('203.0.113.10');
    });

    it('should trim whitespace around the extracted forwarded IP', async () => {
      const req = {
        headers: { 'x-forwarded-for': '  203.0.113.10  , 70.41.3.18' },
        ip: '127.0.0.1',
      };

      const tracker = await (guard as any).getTracker(req);

      expect(tracker).toBe('203.0.113.10');
    });

    it('should fall back to req.ip when x-forwarded-for header is missing', async () => {
      const req = {
        headers: {},
        ip: '127.0.0.1',
      };

      const tracker = await (guard as any).getTracker(req);

      expect(tracker).toBe('127.0.0.1');
    });
  });

  describe('throwThrottlingException', () => {
    it('should throw HttpException with a custom message', () => {
      const ctx = {} as ExecutionContext;

      expect(() => guard.throwThrottlingException(ctx)).toThrow(HttpException);
      expect(() => guard.throwThrottlingException(ctx)).toThrow('Too many attempts. Please try again in a moment.');
    });

    it('should carry a stable IP_RATE_LIMITED code for the frontend to key off of', () => {
      const ctx = {} as ExecutionContext;

      expect.assertions(1);
      try {
        guard.throwThrottlingException(ctx);
      } catch (err) {
        expect((err as HttpException).getResponse()).toMatchObject({ code: 'IP_RATE_LIMITED' });
      }
    });
  });
});
