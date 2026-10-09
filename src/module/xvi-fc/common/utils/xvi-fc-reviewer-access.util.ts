import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';

/**
 * ADMIN bypasses every reviewer scope, same as it bypasses state scope in `hasStateAccess`.
 * Parameterized by `Scope` (rather than one function per reviewer role) so a future reviewer stage
 * needs no new function here — only a new call site passing its own scope and message.
 */
export function hasReviewerAccess(user: AuthUser, reviewerScope: Scope): boolean {
  return user.scope === reviewerScope || user.scope === Scope.ADMIN;
}

/**
 * `message` is always caller-supplied rather than hardcoded here — the pre-existing MoHUA reviewer
 * services already use slightly different wording for this same check across their own call sites,
 * so a single hardcoded message would be a behavior change for them, not just a structural one.
 */
export function assertReviewerAccess(user: AuthUser, reviewerScope: Scope, message: string): void {
  if (!hasReviewerAccess(user, reviewerScope)) {
    throw new ForbiddenException(message);
  }
}

/** The exact wording all 7 existing PMU review/rows services already use for this check. */
export const PMU_REVIEWER_FORBIDDEN_MESSAGE = 'Only PMU or admin users may review state submissions.';

/** What every PMU review/rows service actually calls — pins the PMU scope and its existing message. */
export function assertPmuReviewerAccess(user: AuthUser): void {
  assertReviewerAccess(user, Scope.PMU, PMU_REVIEWER_FORBIDDEN_MESSAGE);
}
