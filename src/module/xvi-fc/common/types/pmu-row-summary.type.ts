export interface PmuRowSummaryCore {
  total: number;
  active: number;
  updatePending: number;
  rejected: number;
  needsUpdate: number;
}

/** Elected Urban Local Bodies rows have no `eligibility` field; FC Unspent Declaration rows do. */
export interface PmuRowSummaryWithEligibility extends PmuRowSummaryCore {
  eligible: number;
  ineligible: number;
}
