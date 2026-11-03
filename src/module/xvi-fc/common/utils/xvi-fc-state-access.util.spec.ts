import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import {
  assertStateAccess,
  buildStateFormPermissions,
  canDecideUlb,
  canViewUlb,
  hasStateAccess,
} from './xvi-fc-state-access.util';

const stateId = new Types.ObjectId().toString();
const otherStateId = new Types.ObjectId().toString();

const adminUser: AuthUser = { _id: new Types.ObjectId().toString(), scope: Scope.ADMIN, state: null } as AuthUser;

const stateUser = (state: string): AuthUser =>
  ({ _id: new Types.ObjectId().toString(), scope: Scope.STATE, state }) as unknown as AuthUser;

const mohuaUser: AuthUser = { _id: new Types.ObjectId().toString(), scope: Scope.MOHUA, state: null } as AuthUser;

describe('hasStateAccess', () => {
  it('returns true for ADMIN regardless of stateId', () => {
    expect(hasStateAccess(adminUser, stateId)).toBe(true);
  });

  it('returns true for a STATE user matching their own state', () => {
    expect(hasStateAccess(stateUser(stateId), stateId)).toBe(true);
  });

  it('returns false for a STATE user on a different state', () => {
    expect(hasStateAccess(stateUser(stateId), otherStateId)).toBe(false);
  });

  it('returns false for a non-ADMIN, non-STATE scope', () => {
    expect(hasStateAccess(mohuaUser, stateId)).toBe(false);
  });

  it('returns false for a STATE user with no state set', () => {
    expect(hasStateAccess(stateUser(null as unknown as string), stateId)).toBe(false);
  });
});

describe('assertStateAccess', () => {
  it('does not throw for ADMIN', () => {
    expect(() => assertStateAccess(adminUser, stateId)).not.toThrow();
  });

  it('does not throw for a STATE user matching their own state', () => {
    expect(() => assertStateAccess(stateUser(stateId), stateId)).not.toThrow();
  });

  it('throws ForbiddenException with the STATE-specific message for a mismatched state', () => {
    expect(() => assertStateAccess(stateUser(stateId), otherStateId)).toThrow(
      new ForbiddenException('You can only access your own state data'),
    );
  });

  it('throws ForbiddenException with the generic message for a disallowed scope', () => {
    expect(() => assertStateAccess(mohuaUser, stateId)).toThrow(new ForbiddenException('Access denied'));
  });
});

describe('buildStateFormPermissions', () => {
  // XVIFC_STATE_PERMISSIONS.admin carries VIEW/EDIT/FINAL_SUBMIT_STATE_FORMS; .viewer carries only
  // VIEW_STATE_FORMS (src/module/auth/permissions.map.ts) - real subroles, not ad-hoc fixtures.
  const fullyPermissionedStateUser = (state: string): AuthUser =>
    ({
      _id: new Types.ObjectId().toString(),
      scope: Scope.STATE,
      state,
      xviFcSubrole: 'admin',
    }) as unknown as AuthUser;

  const viewerOnlyStateUser = (state: string): AuthUser =>
    ({
      _id: new Types.ObjectId().toString(),
      scope: Scope.STATE,
      state,
      xviFcSubrole: 'viewer',
    }) as unknown as AuthUser;

  it('grants all three flags for a fully-permissioned STATE user on an editable status', () => {
    const result = buildStateFormPermissions(fullyPermissionedStateUser(stateId), stateId, FORM_STATUS.IN_PROGRESS);
    expect(result).toEqual({ canView: true, canEdit: true, canFinalSubmit: true });
  });

  it('denies canEdit/canFinalSubmit once the status is no longer editable, even with full permissions', () => {
    const result = buildStateFormPermissions(
      fullyPermissionedStateUser(stateId),
      stateId,
      FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
    );
    expect(result).toEqual({ canView: true, canEdit: false, canFinalSubmit: false });
  });

  it('denies every flag when the user does not have state access, regardless of permissions', () => {
    const result = buildStateFormPermissions(
      fullyPermissionedStateUser(stateId),
      otherStateId,
      FORM_STATUS.IN_PROGRESS,
    );
    expect(result).toEqual({ canView: false, canEdit: false, canFinalSubmit: false });
  });

  it('denies canEdit/canFinalSubmit for a viewer-only STATE user', () => {
    const result = buildStateFormPermissions(viewerOnlyStateUser(stateId), stateId, FORM_STATUS.IN_PROGRESS);
    expect(result).toEqual({ canView: true, canEdit: false, canFinalSubmit: false });
  });

  it('denies every flag to an ADC admin of the same state — State forms are not theirs', () => {
    const adcAdmin = {
      ...fullyPermissionedStateUser(stateId),
      adc: new Types.ObjectId().toString(),
    } as unknown as AuthUser;
    const result = buildStateFormPermissions(adcAdmin, stateId, FORM_STATUS.IN_PROGRESS);
    expect(result).toEqual({ canView: false, canEdit: false, canFinalSubmit: false });
  });
});

describe('ULB ownership (canViewUlb / canDecideUlb)', () => {
  const STATE_A = new Types.ObjectId();
  const STATE_B = new Types.ObjectId();
  const ADC_1 = new Types.ObjectId();
  const ADC_2 = new Types.ObjectId();

  const admin = { _id: 'a', role: 'ADMIN', scope: Scope.ADMIN } as AuthUser;
  const dmaUser = { _id: 's', role: 'STATE', scope: Scope.STATE, state: STATE_A, adc: null } as AuthUser;
  const adcUser = { _id: 'c', role: 'STATE', scope: Scope.STATE, state: STATE_A, adc: String(ADC_1) } as AuthUser;
  const ulbUser = { _id: 'u', role: 'ULB', scope: Scope.ULB } as AuthUser;

  const stateUlb = { state: STATE_A, adc: null };
  const adc1Ulb = { state: STATE_A, adc: ADC_1 };
  const adc2Ulb = { state: STATE_A, adc: ADC_2 };
  const otherStateUlb = { state: STATE_B, adc: null };

  describe('canViewUlb', () => {
    it('lets ADMIN see every ULB', () => {
      expect([stateUlb, adc1Ulb, otherStateUlb].every((u) => canViewUlb(admin, u))).toBe(true);
    });

    it('lets a State user see every ULB of their own state, ADC-owned or not, but no other state', () => {
      expect(canViewUlb(dmaUser, stateUlb)).toBe(true);
      expect(canViewUlb(dmaUser, adc1Ulb)).toBe(true);
      expect(canViewUlb(dmaUser, otherStateUlb)).toBe(false);
    });

    it('lets an ADC user see only the ULBs of their own ADC', () => {
      expect(canViewUlb(adcUser, adc1Ulb)).toBe(true);
      expect(canViewUlb(adcUser, adc2Ulb)).toBe(false);
      expect(canViewUlb(adcUser, stateUlb)).toBe(false);
      expect(canViewUlb(adcUser, otherStateUlb)).toBe(false);
    });

    it('denies every other scope', () => {
      expect(canViewUlb(ulbUser, stateUlb)).toBe(false);
    });

    it('compares plain-string and ObjectId ids alike', () => {
      expect(canViewUlb(adcUser, { state: String(STATE_A), adc: String(ADC_1) })).toBe(true);
    });
  });

  describe('canDecideUlb', () => {
    it('lets ADMIN decide every ULB', () => {
      expect([stateUlb, adc1Ulb].every((u) => canDecideUlb(admin, u))).toBe(true);
    });

    it('lets a State user decide only ULBs with no ADC — an ADC-owned ULB is view-only for the State', () => {
      expect(canDecideUlb(dmaUser, stateUlb)).toBe(true);
      expect(canDecideUlb(dmaUser, adc1Ulb)).toBe(false);
      expect(canDecideUlb(dmaUser, otherStateUlb)).toBe(false);
    });

    it('lets an ADC user decide only the ULBs of their own ADC', () => {
      expect(canDecideUlb(adcUser, adc1Ulb)).toBe(true);
      expect(canDecideUlb(adcUser, adc2Ulb)).toBe(false);
      expect(canDecideUlb(adcUser, stateUlb)).toBe(false);
    });

    it("follows the ULB's current ADC: once reassigned, the old owner loses the right immediately", () => {
      const ulb = { state: STATE_A, adc: ADC_1 };
      expect(canDecideUlb(adcUser, ulb)).toBe(true);
      ulb.adc = ADC_2;
      expect(canDecideUlb(adcUser, ulb)).toBe(false);
    });

    it('denies every other scope', () => {
      expect(canDecideUlb(ulbUser, stateUlb)).toBe(false);
    });
  });
});
