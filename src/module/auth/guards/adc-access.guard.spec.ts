import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Scope } from '../enum/roles-xvi-fc.enum';
import { AdcAccessGuard } from './adc-access.guard';

const ADC_USER_ID = '65f000000000000000000001';
const ADC_ID = '65f0000000000000000000aa';

function makeContext(method: string, path: string, user: Record<string, unknown> | undefined): ExecutionContext {
  const request = { method, path, user };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const adcUser = { _id: ADC_USER_ID, scope: Scope.STATE, adc: ADC_ID };
const stateUser = { _id: '65f000000000000000000002', scope: Scope.STATE, adc: null };

describe('AdcAccessGuard', () => {
  const guard = new AdcAccessGuard();

  it('lets a public request (no user) through', () => {
    expect(guard.canActivate(makeContext('GET', '/api/v2/xvi-fc/state/abc', undefined))).toBe(true);
  });

  it.each([
    ['a State user', stateUser],
    ['a ULB user', { _id: 'u', scope: Scope.ULB, adc: null }],
    ['an admin', { _id: 'a', scope: Scope.ADMIN }],
  ])('never restricts %s', (_label, user) => {
    expect(guard.canActivate(makeContext('GET', '/api/v2/xvi-fc/state/abc/y/dashboard', user))).toBe(true);
    expect(guard.canActivate(makeContext('POST', '/api/v2/xvi-fc/state/claim-letter', user))).toBe(true);
  });

  it.each([
    ['GET', '/api/v2/auth/me'],
    ['GET', '/api/v2/xvi-fc/sidebar/STATE'],
    ['GET', '/api/v2/xvi-fc/years'],
    ['GET', '/api/v2/xvi-fc/annual-account/state/ulb-submissions'],
    ['GET', '/api/v2/xvi-fc/bank-account/state/ulb-submissions'],
    ['GET', '/api/v2/xvi-fc/dur/state/ulb-submissions'],
    ['GET', '/api/v2/xvi-fc/ulb/slb/state/ulb-submissions'],
    ['GET', '/api/v2/xvi-fc/state/ulb-submissions/export'],
    ['GET', '/api/v2/xvi-fc/annual-account/by-ulb/ulb1/year1'],
    ['GET', '/api/v2/xvi-fc/dur/abc/logs'],
    ['POST', '/api/v2/xvi-fc/annual-account/abc/decision'],
    ['POST', '/api/v2/xvi-fc/bank-account/abc/undo-approval'],
    ['POST', '/api/v2/xvi-fc/dur/bulk-decision'],
    ['POST', '/api/v2/xvi-fc/annual-account/abc/documents/doc1/decision'],
    ['DELETE', '/api/v2/xvi-fc/annual-account/abc/documents/doc1/decision'],
    ['GET', '/api/v2/master/ulb'],
    ['POST', '/api/v2/master/ulb'],
    ['PATCH', '/api/v2/master/ulb/abc'],
    ['POST', '/api/v2/file/signed-url'],
    ['GET', '/api/v2/users/adc-members/'],
    ['POST', '/api/v2/users/invite-adc-member'],
    ['POST', '/api/v2/users/adc-members/transfer-submitter'],
    ['PATCH', '/api/v2/users/adc-members/abc/sub-role'],
    ['DELETE', '/api/v2/users/adc-members/abc'],
  ])('lets an ADC user %s %s through', (method, path) => {
    expect(guard.canActivate(makeContext(method, path, adcUser))).toBe(true);
  });

  it.each([
    // State forms, claim letter, State dashboard/overview
    ['GET', '/api/v2/xvi-fc/state/abc/y/dashboard'],
    ['GET', '/api/v2/xvi-fc/state/abc'],
    ['GET', '/api/v2/xvi-fc/state-info/abc'],
    ['GET', '/api/v2/xvi-fc/state/claim-letter/abc'],
    ['POST', '/api/v2/xvi-fc/state/sfc-status/abc/final-submit'],
    ['POST', '/api/v2/xvi-fc/pmu/gtc/s/y/1/approve'],
    // State team, overrides, admin user routes
    ['GET', '/api/v2/users/state-members'],
    ['POST', '/api/v2/users/invite-state-member'],
    ['PATCH', '/api/v2/users/abc/sub-role'],
    ['DELETE', '/api/v2/users/abc'],
    ['PATCH', '/api/v2/users/abc/permission-overrides'],
    ['POST', '/api/v2/users/transfer-submitter'],
    ['POST', '/api/v2/users'],
    // ULB master: single read, approve, year-access, assign ADC
    ['GET', '/api/v2/master/ulb/abc'],
    ['PATCH', '/api/v2/master/ulb/abc/approve'],
    ['PATCH', '/api/v2/master/ulb/abc/adc'],
    ['PATCH', '/api/v2/master/ulb/abc/year-access'],
    ['GET', '/api/v2/master/adc'],
    // Side-menu CRUD and cache
    ['POST', '/api/v2/xvi-fc/side-menu'],
    ['DELETE', '/api/v2/xvi-fc/admin/cache/side-menu'],
    // The forms' ULB-facing writes
    ['POST', '/api/v2/xvi-fc/annual-account/abc/submit'],
    ['POST', '/api/v2/xvi-fc/ulb/slb/final-submit'],
  ])('blocks an ADC user %s %s', (method, path) => {
    expect(() => guard.canActivate(makeContext(method, path, adcUser))).toThrow(ForbiddenException);
  });

  it('lets an ADC user read and update only their own profile', () => {
    expect(guard.canActivate(makeContext('GET', `/api/v2/users/${ADC_USER_ID}/profile-contacts`, adcUser))).toBe(true);
    expect(guard.canActivate(makeContext('PATCH', `/api/v2/users/${ADC_USER_ID}/profile-contacts`, adcUser))).toBe(
      true,
    );
    expect(() => guard.canActivate(makeContext('GET', '/api/v2/users/someone-else/profile-contacts', adcUser))).toThrow(
      ForbiddenException,
    );
    expect(() =>
      guard.canActivate(makeContext('PATCH', '/api/v2/users/someone-else/profile-contacts', adcUser)),
    ).toThrow(ForbiddenException);
  });
});
