/**
 * User-facing message shown when a Cantonment Board ULB is blocked from an XVI FC (16th Finance
 * Commission) action — the login rejection, every write-path guard, and the row-PATCH guards all
 * throw this exact string via `UlbEligibilityService.assertUlbEligibleForGrantCycle(..., message)`
 * or a direct `ForbiddenException`. Centralized here instead of retyped at each call site so it
 * can't drift out of sync between them.
 *
 * ⚠️ THE FRONTEND MATCHES ON THIS EXACT STRING. `login.component.ts`
 * (cityfinance-ng-ui-v2/src/app/auth/login/login.component.ts) compares a failed login's error
 * message against this literal text to decide whether to redirect to the dedicated
 * `/xvifc-not-eligible` page instead of showing an inline error. If you change this message, you
 * MUST update that frontend match in the same change, or Cantonment-Board ULBs will see a raw
 * inline error instead of being redirected.
 */
export const CANTONMENT_BOARD_XVIFC_INELIGIBLE_MESSAGE = 'Cantonment boards are not eligible for XVIFC';
