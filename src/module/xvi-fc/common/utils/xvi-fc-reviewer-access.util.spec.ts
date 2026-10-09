import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Permission, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { assertPmuOrMohuaViewerAccess, assertPmuReviewerAccess } from './xvi-fc-reviewer-access.util';
import { buildPmuReviewerFormPermissions } from './xvi-fc-reviewer-permissions.util';

const user = (role: string, scope: Scope, xviFcSubrole: 'admin' | 'reviewer' | 'viewer' = 'viewer'): AuthUser => ({
  _id: 'u1',
  role,
  scope,
  accessLevel: AccessLevel.VIEWER,
  xviFcSubrole,
  state: null,
});

const mohua = (subrole: 'admin' | 'reviewer' | 'viewer') => user(UserRole.MoHUA, Scope.MOHUA, subrole);

describe('PMU review access for MoHUA (view only)', () => {
  describe('assertPmuOrMohuaViewerAccess', () => {
    it('lets PMU, MoHUA and admin read', () => {
      expect(() => assertPmuOrMohuaViewerAccess(user(UserRole.PMU, Scope.PMU))).not.toThrow();
      expect(() => assertPmuOrMohuaViewerAccess(mohua('viewer'))).not.toThrow();
      expect(() => assertPmuOrMohuaViewerAccess(user(UserRole.ADMIN, Scope.ADMIN))).not.toThrow();
    });

    it('keeps State and ULB users out', () => {
      expect(() => assertPmuOrMohuaViewerAccess(user(UserRole.STATE, Scope.STATE))).toThrow(ForbiddenException);
      expect(() => assertPmuOrMohuaViewerAccess(user(UserRole.ULB, Scope.ULB))).toThrow(ForbiddenException);
    });
  });

  it('still blocks MoHUA from the PMU-only check used by approve/reject, worklists and bulk row actions', () => {
    expect(() => assertPmuReviewerAccess(mohua('admin'))).toThrow(ForbiddenException);
  });

  it('gives every MoHUA subrole the PMU read permission but never the PMU approve permission', () => {
    for (const subrole of ['admin', 'reviewer', 'viewer'] as const) {
      const permissions = getEffectivePermissions(mohua(subrole));
      expect(permissions).toContain(Permission.REVIEW_STATE_SUBMISSIONS_PMU);
      expect(permissions).not.toContain(Permission.APPROVE_STATE_SUBMISSIONS_PMU);
    }
  });

  it('shows MoHUA a form under review by PMU as viewable but not approvable or returnable', () => {
    const permissions = buildPmuReviewerFormPermissions(mohua('admin'), FORM_STATUS.UNDER_REVIEW_BY_PMU);

    expect(permissions.canView).toBe(true);
    expect(permissions.canApproveForm).toBe(false);
    expect(permissions.canRejectForm).toBe(false);
  });

  it('applies the same status gate to MoHUA as to PMU: draft and returned statuses are viewable, others are not', () => {
    const canView = (status: number) => buildPmuReviewerFormPermissions(mohua('viewer'), status).canView;

    for (const status of [13, 14, 1, 2, 5, 6, 7]) expect(canView(status)).toBe(true);
    for (const status of [0, 3, 4, 8, 12]) expect(canView(status)).toBe(false);
  });
});
