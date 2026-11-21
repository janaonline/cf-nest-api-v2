import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { isMohuaViewScope, isNationalDashboardScope } from './xvi-fc-scope.util';

const as = (scope: Scope | null) => ({ scope }) as Pick<AuthUser, 'scope'>;

describe('xvi-fc scope checks', () => {
  it('lets MoHUA, DoE and PMU read the national dashboard', () => {
    expect(isNationalDashboardScope(as(Scope.MOHUA))).toBe(true);
    expect(isNationalDashboardScope(as(Scope.DOE))).toBe(true);
    expect(isNationalDashboardScope(as(Scope.PMU))).toBe(true);
  });

  it('keeps States and ULBs out of it', () => {
    expect(isNationalDashboardScope(as(Scope.STATE))).toBe(false);
    expect(isNationalDashboardScope(as(Scope.ULB))).toBe(false);
    expect(isNationalDashboardScope(as(null))).toBe(false);
  });

  it('does not widen isMohuaViewScope to PMU (it also guards other MoHUA reads and stub writes)', () => {
    expect(isMohuaViewScope(as(Scope.PMU))).toBe(false);
  });
});
