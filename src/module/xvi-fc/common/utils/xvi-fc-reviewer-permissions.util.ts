import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { canPmuMutateForm, canPmuViewForm } from './xvi-fc-form-status-access.util';
import type { PmuReviewPermissions } from '../types/pmu-review-permissions.type';

export interface ReviewerFormPermissionGates {
  viewPermission: Permission;
  mutatePermission: Permission;
  canView: (status: number) => boolean;
  canMutate: (status: number) => boolean;
  /** Set only for forms with row-level review (Elected Urban Local Bodies, FC Unspent Declaration). */
  includeRowReview?: boolean;
}

/**
 * Generic core mirroring `buildStateFormPermissions`'s design. Not PMU-specific — a future reviewer
 * stage with its own permission pair and status gates can call this directly instead of
 * hand-rolling its own `buildPermissions` private method, the way every PMU review service today
 * independently does.
 */
export function buildReviewerFormPermissions(
  user: AuthUser,
  status: number,
  gates: ReviewerFormPermissionGates,
): PmuReviewPermissions {
  const perms = new Set(getEffectivePermissions(user));
  const canView = perms.has(gates.viewPermission) && gates.canView(status);
  const canMutate = perms.has(gates.mutatePermission) && gates.canMutate(status);
  const result: PmuReviewPermissions = { canView, canApproveForm: canMutate, canRejectForm: canMutate };
  if (gates.includeRowReview) result.canReviewRows = canMutate;
  return result;
}

/** What all 5 PMU review services actually call — pins the PMU-specific permission pair and gates. */
export function buildPmuReviewerFormPermissions(
  user: AuthUser,
  status: number,
  opts?: { includeRowReview?: boolean },
): PmuReviewPermissions {
  return buildReviewerFormPermissions(user, status, {
    viewPermission: Permission.REVIEW_STATE_SUBMISSIONS_PMU,
    mutatePermission: Permission.APPROVE_STATE_SUBMISSIONS_PMU,
    canView: canPmuViewForm,
    canMutate: canPmuMutateForm,
    includeRowReview: opts?.includeRowReview,
  });
}
