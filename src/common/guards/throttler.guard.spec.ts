import { ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { CustomThrottlerGuard } from './throttler.guard';

describe('CustomThrottlerGuard', () => {
  let guard: CustomThrottlerGuard;

  beforeEach(() => {
    // Provide all constructor args required by ThrottlerGuard
    guard = new CustomThrottlerGuard(
      [{ ttl: 60000, limit: 60 }],
      { isThrottled: jest.fn() } as any,
      { get: jest.fn() } as any,
    );
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('throwThrottlingException', () => {
    it('should throw ThrottlerException with custom message', () => {
      const ctx = {} as ExecutionContext;
      expect(() => guard.throwThrottlingException(ctx)).toThrow(ThrottlerException);
      expect(() => guard.throwThrottlingException(ctx)).toThrow(
        'Too many attempts. Please try again in a moment.',
      );
    });
  });
});
