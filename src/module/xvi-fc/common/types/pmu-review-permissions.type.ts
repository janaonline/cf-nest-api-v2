/**
 * Shared shape for every PMU review service's `permissions` field. `canReviewRows` is optional
 * because GTC/SFC Status/Devolution Formula have no row-level review concept at all — making it
 * required would force those 3 forms to fabricate a meaningless boolean in their JSON response.
 * Elected Urban Local Bodies' and FC Unspent Declaration's own per-form aliases narrow it back to
 * required, since their services always populate it.
 */
export interface PmuReviewPermissions {
  canView: boolean;
  canApproveForm: boolean;
  canRejectForm: boolean;
  canReviewRows?: boolean;
  /** PMU may reverse its own approve/return: status is 5 or 14, the caller can approve as PMU, and no
   *  claim letter has been started for the state/year (see `PmuUndoEligibilityService`). */
  canUndo?: boolean;
}
