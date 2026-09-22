import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { assertStateAccess, buildStateFormPermissions, hasStateAccess } from './xvi-fc-state-access.util';

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
});
