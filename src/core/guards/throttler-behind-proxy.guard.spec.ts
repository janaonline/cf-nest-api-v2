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
    it('should use req.ip (resolved by express trust proxy) and ignore a raw x-forwarded-for header', async () => {
      const req = {
        headers: { 'x-forwarded-for': '1.2.3.4' },
        ip: '203.0.113.10',
      };

      const tracker = await (guard as any).getTracker(req);

      expect(tracker).toBe('203.0.113.10');
    });

    it('should fall back to the socket address when req.ip is missing', async () => {
      const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };

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
