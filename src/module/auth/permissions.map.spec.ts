import { Permission, Scope, UserRole } from './enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from './permissions.map';
import { parseUserRole } from './roles-xvi-fc.helper';

const DECIDE_PERMISSIONS = [
  Permission.APPROVE_STATE_SUBMISSIONS_PMU,
  Permission.APPROVE_STATE_SUBMISSIONS,
  Permission.REVIEW_STATE_SUBMISSIONS,
  Permission.APPROVE_ULB_SUBMISSIONS,
  Permission.REVIEW_ULB_SUBMISSIONS,
  Permission.FINAL_SUBMIT_TO_DOE,
  Permission.FINAL_SUBMIT_TO_MOHUA,
  Permission.EDIT_STATE_FORMS,
  Permission.UPLOAD_DOCUMENTS,
  Permission.UPLOAD_STATE_LEVEL_DOCUMENTS,
];

describe('XVI-FC permission tables', () => {
  describe('DoE (read-only copy of the MoHUA dashboard)', () => {
    it.each(['admin', 'reviewer', 'viewer'])('%s holds no approve, review-and-decide or write permission', (sub) => {
      const perms = getEffectivePermissions({ role: UserRole.DOE, xviFcSubrole: sub });
      for (const decide of DECIDE_PERMISSIONS) expect(perms).not.toContain(decide);
    });

    it.each(['admin', 'reviewer', 'viewer'])('%s can open the dashboard and the read-only form screens', (sub) => {
      const perms = getEffectivePermissions({ role: UserRole.DOE, xviFcSubrole: sub });
      expect(perms).toEqual(
        expect.arrayContaining([
          Permission.VIEW_STATUS_REPORTS,
          Permission.VIEW_DASHBOARDS,
          Permission.REVIEW_STATE_SUBMISSIONS_PMU,
        ]),
      );
    });

    it('lets only the admin (Submitter) manage the DoE team', () => {
      expect(getEffectivePermissions({ role: UserRole.DOE, xviFcSubrole: 'admin' })).toContain(Permission.MANAGE_USERS);
      expect(getEffectivePermissions({ role: UserRole.DOE, xviFcSubrole: 'reviewer' })).not.toContain(
        Permission.MANAGE_USERS,
      );
    });

    it('defaults to viewer when the subrole is unset, and resolves to the DOE scope', () => {
      expect(getEffectivePermissions({ role: UserRole.DOE })).not.toContain(Permission.MANAGE_USERS);
      expect(parseUserRole(UserRole.DOE, 'admin')?.scope).toBe(Scope.DOE);
    });
  });

  describe('PMU', () => {
    it('lets the viewer open state forms (read gate) but never approve them', () => {
      const perms = getEffectivePermissions({ role: UserRole.PMU, xviFcSubrole: 'viewer' });
      expect(perms).toContain(Permission.REVIEW_STATE_SUBMISSIONS_PMU);
      expect(perms).not.toContain(Permission.APPROVE_STATE_SUBMISSIONS_PMU);
    });

    it('lets the admin and the reviewer approve or return state submissions, but not the viewer', () => {
      for (const sub of ['admin', 'reviewer']) {
        expect(getEffectivePermissions({ role: UserRole.PMU, xviFcSubrole: sub })).toContain(
          Permission.APPROVE_STATE_SUBMISSIONS_PMU,
        );
      }
      expect(getEffectivePermissions({ role: UserRole.PMU, xviFcSubrole: 'viewer' })).not.toContain(
        Permission.APPROVE_STATE_SUBMISSIONS_PMU,
      );
    });

    it('lets only the admin manage the PMU team', () => {
      expect(getEffectivePermissions({ role: UserRole.PMU, xviFcSubrole: 'admin' })).toContain(Permission.MANAGE_USERS);
      expect(getEffectivePermissions({ role: UserRole.PMU, xviFcSubrole: 'reviewer' })).not.toContain(
        Permission.MANAGE_USERS,
      );
    });
  });

  describe('ADC (STATE role with an ADC)', () => {
    const adc = 'adc-1';
    const permsOf = (xviFcSubrole: string, extra: object = {}) =>
      getEffectivePermissions({ role: UserRole.STATE, xviFcSubrole, adc, ...extra });

    it('lets the admin and the reviewer review and approve ULB submissions', () => {
      for (const sub of ['admin', 'reviewer']) {
        const perms = permsOf(sub);
        expect(perms).toContain(Permission.REVIEW_ULB_SUBMISSIONS);
        expect(perms).toContain(Permission.APPROVE_ULB_SUBMISSIONS);
      }
    });

    it('lets the viewer read the review lists but never approve', () => {
      const perms = permsOf('viewer');
      expect(perms).toContain(Permission.REVIEW_ULB_SUBMISSIONS);
      expect(perms).not.toContain(Permission.APPROVE_ULB_SUBMISSIONS);
    });

    it('never grants a State-form, claim-letter, exemption or user-management permission', () => {
      const forbidden = [
        Permission.VIEW_STATE_FORMS,
        Permission.EDIT_STATE_FORMS,
        Permission.FINAL_SUBMIT_STATE_FORMS,
        Permission.PREPARE_GRANT_LETTERS,
        Permission.RECOMMEND_EXEMPTIONS,
        Permission.FINAL_SUBMIT_TO_MOHUA,
        Permission.VIEW_DASHBOARDS,
        Permission.MANAGE_USERS,
      ];
      for (const sub of ['admin', 'reviewer', 'viewer']) {
        const perms = permsOf(sub);
        for (const p of forbidden) expect(perms).not.toContain(p);
      }
    });

    it('ignores permission overrides, so they cannot widen an ADC user into State forms', () => {
      const perms = permsOf('reviewer', {
        permissionOverrides: { allow: [Permission.EDIT_STATE_FORMS], deny: [Permission.APPROVE_ULB_SUBMISSIONS] },
      });
      expect(perms).not.toContain(Permission.EDIT_STATE_FORMS);
      expect(perms).toContain(Permission.APPROVE_ULB_SUBMISSIONS);
    });

    it('leaves a plain State user (adc null) on the State table', () => {
      const perms = getEffectivePermissions({ role: UserRole.STATE, xviFcSubrole: 'reviewer', adc: null });
      expect(perms).toContain(Permission.EDIT_STATE_FORMS);
    });
  });
});
