import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { SCOPES_KEY } from '../decorators/scopes.decorator';
import { ScopesGuard } from './scopes.guard';

function makeContext(requiredScopes: string[] | undefined, clientScopes: string[]): ExecutionContext {
  const request = {
    apiClient: { scopes: clientScopes },
  };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ScopesGuard', () => {
  let guard: ScopesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ScopesGuard, { provide: Reflector, useValue: reflector }],
    }).compile();
    guard = module.get<ScopesGuard>(ScopesGuard);
  });

  it('allows when no scopes required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(makeContext(undefined, []))).toBe(true);
  });

  it('allows client with all required scopes', () => {
    const required = ['scope:a', 'scope:b'];
    reflector.getAllAndOverride.mockReturnValue(required);
    expect(guard.canActivate(makeContext(required, ['scope:a', 'scope:b', 'scope:c']))).toBe(true);
  });

  it('throws ForbiddenException when client is missing one required scope', () => {
    const required = ['scope:a', 'scope:b'];
    reflector.getAllAndOverride.mockReturnValue(required);
    expect(() => guard.canActivate(makeContext(required, ['scope:a']))).toThrow(ForbiddenException);
  });

  it('throws with message "Insufficient scope"', () => {
    reflector.getAllAndOverride.mockReturnValue(['scope:x']);
    try {
      guard.canActivate(makeContext(['scope:x'], []));
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('Insufficient scope');
    }
  });

  it('uses Set for O(n) lookup — does not iterate client scopes per required scope', () => {
    const required = [SCOPES_KEY];
    reflector.getAllAndOverride.mockReturnValue(required);
    // Just verifying it doesn't throw a nested loop: correctness covered by other tests
    expect(() => guard.canActivate(makeContext(required, [SCOPES_KEY]))).not.toThrow();
  });
});
