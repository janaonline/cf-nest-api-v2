import type {
  MOHUA_CLAIM_LETTERS_FIRST_CLAIM_STATUS,
  MOHUA_CLAIM_LETTERS_ULB_STATUS,
} from './mohua-claim-letters.constants';

/** All money is whole Rupees, as everywhere else in xvi-fc; the UI converts to crore for display. */
export interface MohuaClaimLettersStateRow {
  stateId: string;
  name: string;
  code: string;
  firstClaimStatus: (typeof MOHUA_CLAIM_LETTERS_FIRST_CLAIM_STATUS)[keyof typeof MOHUA_CLAIM_LETTERS_FIRST_CLAIM_STATUS];
  /** The state's allocation for this installment: half of the year's basic + performance grant; null when it has none. */
  installmentAllocation: number | null;
  /** Total claimed across the state's listed claim letters; null when it has none. */
  amountClaimed: number | null;
  /** ULBs included across those letters; null when it has none. */
  ulbsIncluded: number | null;
  /** The state's expected ULBs for the year (ExpectedUlbSetService), so the UI can show "ulbsIncluded of totalUlbs". */
  totalUlbs: number;
  claimLetterCount: number;
  /** The highest claim letter number the state has submitted (1, 2, 3...), null when none. */
  latestClaimNumber: number | null;
  /** Every listed letter of the state, newest first: the expanded row and the summary-card filters read these. */
  claimLetters: MohuaClaimLetterListItem[];
}

/** Claim letters at one stage: how many, from how many States, and their amount (whole Rupees). */
export interface MohuaClaimStage {
  claims: number;
  states: number;
  amount: number;
}

/**
 * The national figures above the States table. `submitted` counts every listed letter (returned ones too) but its
 * amount leaves returned letters out, since their ULBs come back in the replacement letter. Released is not
 * tracked yet (the DoE release step isn't built), so it is not here.
 */
export interface MohuaClaimLettersOverview {
  /** The installment allocation summed over the listed States. */
  totalAllocation: number;
  stateCount: number;
  submitted: MohuaClaimStage;
  /** Letters under SO review (15). */
  underReview: MohuaClaimStage;
  /** Letters the SO verified (5) or MoHUA acknowledged (7). */
  approved: MohuaClaimStage;
  /** Letters returned for correction (16, 6); amount is what they had claimed. */
  returned: MohuaClaimStage;
}

export interface MohuaClaimLettersStates {
  year: { id: string; label: string };
  installment: number;
  overview: MohuaClaimLettersOverview;
  states: MohuaClaimLettersStateRow[];
}

export interface MohuaClaimLetterListItem {
  id: string;
  /** The claim letter's reference, e.g. CF_TR_2026-27_1. */
  number: string;
  /** Which claim letter of the state this is: 1, 2, 3... (no upper limit). */
  batchNumber: number;
  receivedOn: string | null;
  ulbCount: number;
  amount: number;
  status: number;
  statusLabel: string;
}

/** The band under a state's claim letters. Money is whole Rupees. */
export interface MohuaStateClaimLettersSummary {
  /** Expected ULBs already in a claim letter (returned ones included: their locks stay until a new version). */
  claimedUlbs: number;
  /** Expected ULBs in no claim letter yet. */
  pendingUlbs: number;
  /** ULBs in letters the SO verified (5) or MoHUA acknowledged (7). */
  approvedUlbs: number;
  /** ULBs in letters still under SO review (15). */
  underReviewUlbs: number;
  /** ULBs in returned letters (16, 6); they overlap the others once the State resubmits them. */
  returnedUlbs: number;
  /** Acknowledged plus under review; a returned letter's amount counts as balance until resubmitted. */
  amountClaimed: number;
  /** The installment allocation minus amountClaimed, never below 0. */
  balance: number;
}

export interface MohuaStateClaimLetters {
  state: { id: string; name: string };
  installment: number;
  summary: MohuaStateClaimLettersSummary;
  claimLetters: MohuaClaimLetterListItem[];
}

export interface MohuaClaimLetterFile {
  name: string;
  /** Signed, session-length URL to open the State-signed claim letter. */
  url: string;
  sizeKb: number;
}

export interface MohuaClaimLetterDetail {
  id: string;
  /** Sent back with an approval so a letter changed in the meantime is not approved blind. */
  revision: number;
  number: string;
  state: { id: string; name: string };
  yearId: string;
  installment: number;
  receivedOn: string | null;
  status: number;
  statusLabel: string;
  /** The signed letter the State uploaded; null when none was attached. */
  signedClaimFile: MohuaClaimLetterFile | null;
  /** Money is whole Rupees. */
  summary: {
    /** This letter: its claim and its ULBs. */
    claimAmountReceived: number;
    totalCities: number;
    /** This letter: ULBs that came in through an exemption request, and their claim. */
    exemptionsApplied: number;
    exemptionAmount: number;
    /** Every letter the State submitted for this installment that is under review or acknowledged (returned left out). */
    submittedClaimAmount: number;
    submittedUlbs: number;
  };
  /** Set only on a returned letter: what the return actually reopened (read from its history). */
  returnDetails: MohuaClaimLetterReturnDetails | null;
  /** How many ULBs the SO has marked for return (all pages); approve is refused while it is above 0. */
  returnedUlbCount: number;
  /** ULB exemptions the letter relied on that are still under MoHUA review; approving the letter approves them. */
  pendingExemptionCount: number;
}

/** A form the return reopened; `ulbCount` is how many ULBs' forms/rows it covers (0 for a State form with no rows). */
export interface MohuaClaimLetterReturnedForm {
  formId: number;
  ulbCount: number;
}

export interface MohuaClaimLetterReturnDetails {
  returnedAt: string;
  returnedBy: string | null;
  stateRemark: string | null;
  stateForms: MohuaClaimLetterReturnedForm[];
  ulbForms: MohuaClaimLetterReturnedForm[];
  returnedUlbCount: number;
}

export interface MohuaClaimLetterUlbRow {
  ulbId: string;
  name: string;
  censusCode: string | null;
  /** The ULB's Installment 1 share of the allocation. */
  installmentShare: number;
  claimedAmount: number;
  ulbStatus: (typeof MOHUA_CLAIM_LETTERS_ULB_STATUS)[keyof typeof MOHUA_CLAIM_LETTERS_ULB_STATUS];
  /** On a returned letter, null for a ULB the return did not touch; otherwise the letter's status. */
  reviewStatus: number | null;
  reviewStatusLabel: string | null;
  /** On a returned letter, the formIds reopened for this ULB (its own forms and its State-form rows); else empty. */
  returnedFormIds: number[];
  /** The SO's return mark on this ULB; null = not marked (counts as fine). */
  soDecision: MohuaClaimLetterSoDecision | null;
  /** The ULB's own discretionary exemptions the letter relied on, with their live status (5, 6 or 7). */
  exemptions: MohuaClaimLetterUlbExemption[];
}

export interface MohuaClaimLetterUlbExemption {
  formId: number;
  exemptionId: string;
  /** Live: 5 under MoHUA review, 7 approved, 6 rejected. */
  status: number;
}

export interface MohuaClaimLetterSoDecision {
  status: 'RETURNED';
  /** The ULB's own forms the letter's return will reopen. */
  ulbFormIds: number[];
  /** State forms whose row for this ULB the letter's return will reopen. */
  rowFormIds: number[];
  /** Forms whose pending exemption the letter's return will reject. */
  rejectExemptionFormIds: number[];
  remark: string | null;
  decidedAt: string;
}

export interface MohuaClaimLetterUlbs {
  items: MohuaClaimLetterUlbRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
