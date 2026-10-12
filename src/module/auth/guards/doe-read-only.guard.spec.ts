import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Scope } from '../enum/roles-xvi-fc.enum';
import { DoeReadOnlyGuard } from './doe-read-only.guard';

const DOE_ID = '65f000000000000000000001';

function makeContext(method: string, path: string, scope: Scope | null = Scope.DOE): ExecutionContext {
  const request = { method, path, user: scope ? { _id: DOE_ID, scope } : undefined };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('DoeReadOnlyGuard', () => {
  const guard = new DoeReadOnlyGuard();

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets a DoE user make a %s request', (method) => {
    expect(guard.canActivate(makeContext(method, '/api/v2/xvi-fc/mohua/overview/abc'))).toBe(true);
  });

  it.each([
    ['POST', '/api/v2/file/signed-url'],
    ['POST', '/api/v2/xvi-fc/annual-account/abc/submit'],
    ['PATCH', '/api/v2/xvi-fc/pmu/gtc/s/y/1/approve'],
    ['POST', '/api/v2/xvi-fc/pmu/gtc/s/y/1/approve'],
    ['DELETE', '/api/v2/xvi-fc/admin/cache'],
    ['POST', '/api/v2/users/invite-mohua-member'],
    ['PATCH', '/api/v2/users/permission-overrides'],
  ])('blocks a DoE %s to %s', (method, path) => {
    expect(() => guard.canActivate(makeContext(method, path))).toThrow(ForbiddenException);
  });

  it.each([
    ['POST', '/api/v2/auth/logout'],
    ['PATCH', '/api/v2/auth/set-new-password'],
    ['POST', '/api/v2/email/sendProfileOtp'],
    ['PATCH', '/api/v2/notifications/read-all'],
    ['PATCH', '/api/v2/notifications/abc123/read'],
    ['POST', '/api/v2/users/invite-doe-member'],
    ['POST', '/api/v2/users/doe-members/transfer-submitter'],
    ['PATCH', '/api/v2/users/doe-members/abc/sub-role'],
    ['DELETE', '/api/v2/users/doe-members/abc/'],
  ])('lets a DoE %s to %s through', (method, path) => {
    expect(guard.canActivate(makeContext(method, path))).toBe(true);
  });

  it('lets a DoE user update only its own profile', () => {
    expect(guard.canActivate(makeContext('PATCH', `/api/v2/users/${DOE_ID}/profile-contacts`))).toBe(true);
    expect(() => guard.canActivate(makeContext('PATCH', '/api/v2/users/someone-else/profile-contacts'))).toThrow(
      ForbiddenException,
    );
  });

  it('never touches users of any other scope or unauthenticated requests', () => {
    expect(guard.canActivate(makeContext('POST', '/api/v2/file/signed-url', Scope.MOHUA))).toBe(true);
    expect(guard.canActivate(makeContext('POST', '/api/v2/auth/login', null))).toBe(true);
  });
});
