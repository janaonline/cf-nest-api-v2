import type {
  ClaimLetterAssemblyStatus,
  ClaimLetterBatchNumber,
  ClaimLetterInstallment,
} from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import type {
  EligibilityEvaluationResult,
  UlbEligibilityTally,
} from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import type { PriorFcCycleLabel } from 'src/module/xvi-fc/state/fc-unspent-declaration/helpers/fc-unspent-declaration-cycle.helpers';
import type { ClaimLetterFinancialOverview } from '../services/eligibility/claim-letter-eligibility.service';
import type { ClaimLetterPermissions } from '../helpers/claim-letter-permissions.helpers';

/** Display-ready ULB-options picker row (matches the FC Unspent picker-dialog UX). */
export interface ClaimLetterUlbOption {
  ulbId: string;
  ulbName: string;
  censusCode: string | null;
  sbCode: string | null;
  /** Whole Rupees (no decimals), display-ready — null when the ULB has no active Devolution allocation row. */
  allocationAmount: number | null;
  eligible: boolean;
  ineligibleReasonCode: string | null;
  /** Specific, human-readable reason naming the failing form(s) (e.g. "SLB eligibility criteria not
   *  met") — populated only for `ULB_LEVEL_ELIGIBILITY_CRITERIA_NOT_MET`, so the picker can show
   *  something more useful than the generic humanized code. `null` for every other reason/when eligible. */
  ineligibleReasonDetail: string | null;
}

/** Display-ready selected-ULB table row (matches the FC Unspent Yes-branch table). */
export interface ClaimLetterUlbRow {
  ulbId: string;
  ulbName: string;
  censusCode: string | null;
  sbCode: string | null;
  allocationAmount: number;
  claimAmount: number;
  differencePercentage: number;
  eligible: boolean;
}

/** Whole Rupees (no decimals) — the same unit this is stored in, passed through unconverted. */
export interface ClaimLetterFinancialSummaryDisplay {
  totalInstallmentAllocation: number;
  totalAlreadyAcknowledged: number;
  totalClaimInProgress: number;
  totalClaimInDraft: number;
  availableToClaim: number;
  selectedAllocation: number;
  currentSelectedClaim: number;
  remainingIfAcknowledged: number;
}

export interface ClaimLetterEligibilitySummary {
  /** Resolved from the State document — powers the page-header eyebrow ("16th Finance Commission
   *  · {state}"), same convention as sfc-status/devolution-formula/elected-urban-local-bodies. */
  stateName: string;
  installment: ClaimLetterInstallment;
  /** Which FC cycle "FC Unspent Balance" disclosures refer to for this design year — "14th FC" or
   *  "15th FC" — resolved the same way (and from the same table) as the actual signed Claim Letter
   *  document's own Annexure 1 heading (`ClaimLetterDocumentData.priorFcCycleLabel`), via the
   *  shared `resolvePriorFcCycleLabel` helper, so the two can never disagree. */
  priorFcCycleLabel: PriorFcCycleLabel;
  stateLevelGate: {
    passed: boolean;
    sources: EligibilityEvaluationResult[];
  };
  expectedUlbCount: number;
  batchSlotsUsed: number;
  batchSlotsMax: number;
  /** The batch-slot number that would be allocated if a draft were created right now (the same
   *  first-free-slot rule as `ClaimLetterAssemblyService.allocateBatchNumber()`) — `null` once all
   *  `batchSlotsMax` slots are occupied by a non-abandoned batch. */
  nextBatchNumber: ClaimLetterBatchNumber | null;
  /** State-wide financial context, independent of any one batch — see `ClaimLetterFinancialOverview`
   *  on `ClaimLetterEligibilityService`. Available even before the state has ever created a claim
   *  letter, unlike `ClaimLetterFinancialSummaryDisplay` which only exists on a real batch. */
  financialOverview: {
    totalInstallmentAllocation: number;
    totalAlreadyAcknowledged: number;
    totalClaimInProgress: number;
    totalClaimInDraft: number;
    availableToClaim: number;
  };
  /** Tallies for ULB-level criteria with no state action to gate on (SLB, Provisional/Audited
   *  Annual Accounts) — never blocks `stateLevelGate.passed`; purely informational, shown
   *  separately from the checklist above (see `ClaimLetterUlbLevelEligibility`'s doc comment). */
  ulbLevelCriteria: {
    displayLabel?: string;
    displayDescription?: string;
    tally: UlbEligibilityTally;
  }[];
  /** How many of `expectedUlbCount` ULBs are ELIGIBLE/EXEMPTED on *every* ULB-bulk criterion (SLB,
   *  Provisional/Audited Accounts, Elected Body row, FC Unspent row) — the true intersection across
   *  all of them, not derivable from any single criterion's own tally. Deliberately scoped to just
   *  those criteria: it does NOT factor in Devolution allocation or "locked in another claim," so
   *  it is not the same as "how many ULBs are pickable in the picker" (that remains
   *  `ulb-options`-only) — it answers "how many ULBs meet every requirement shown in this
   *  checklist," which is what the summary panel needed to stop implying "7/7 met" when the
   *  ULB-level rows show near-total failure. */
  ulbReadiness: { eligible: number; total: number };
  /** `expectedUlbCount` minus every ULB currently locked into *any* batch (draft or acknowledged,
   *  regardless of current eligibility) — how many ULBs still have no home in any batch at all.
   *  Drives the FE's proactive "must all be in your final batch" warning, and is the same figure
   *  `ClaimLetterService.submit()` refuses to let the final batch close out on top of. */
  remainingUlbCount: number;
}

/**
 * Lean sibling of `ClaimLetterEligibilitySummary` for the create/edit claim-letter page — exactly
 * the subset of fields that page reads (financial/batch-slot/ULB-count context), with none of the
 * `stateLevelGate`/`ulbLevelCriteria`/`ulbReadiness` fields that page never displays. See
 * `ClaimLetterService.getClaimContext()`.
 */
export interface ClaimLetterClaimContext {
  /** Resolved from the State document — powers the page-header eyebrow, same convention as
   *  `ClaimLetterEligibilitySummary.stateName`. */
  stateName: string;
  expectedUlbCount: number;
  batchSlotsUsed: number;
  batchSlotsMax: number;
  nextBatchNumber: ClaimLetterBatchNumber | null;
  financialOverview: ClaimLetterFinancialOverview;
  remainingUlbCount: number;
  /** DB-driven claimed-vs-allocated variance band (formJson.meta, falls back to
   *  CLAIM_LETTER_VARIANCE_LOWER_PERCENT/UPPER_PERCENT) — see ClaimLetterFormJsonService. */
  varianceLowerPercent: number;
  varianceUpperPercent: number;
  /** Whether the current user may start a new claim (PREPARE_GRANT_LETTERS) — there's no batch
   *  document yet to attach a full ClaimLetterPermissions to, so this is the create-mode-only
   *  equivalent of ClaimLetterBatchSummary.permissions.canEdit. */
  canCreate: boolean;
}

export interface ClaimLetterBatchSummary {
  claimLetterId: string;
  installment: ClaimLetterInstallment;
  batchNumber: ClaimLetterBatchNumber;
  version: number;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  assemblyStatus: ClaimLetterAssemblyStatus;
  ulbCount: number;
  isAbandoned: boolean;
  hasSignedFile: boolean;
  financialSummary: ClaimLetterFinancialSummaryDisplay;
  /** Optimistic-concurrency counter — required as `expectedRevision` on `PATCH .../draft`. */
  revision: number;
  submittedAt: Date | null;
  resolvedAt: Date | null;
  supersedes: string | null;
  supersededBy: string | null;
  createdAt: Date;
  /**
   * Claim Letter's own `formjsons` field config (formId `CLAIM_LETTER_FORM_ID`) — today just the
   * `signedClaimFile` upload field. Only populated by `getDetail`; other endpoints returning this
   * same summary shape leave it `undefined` rather than repeating static config on every row.
   */
  questions?: FieldConfig[];
  /** Resolved from the State document — powers the page-header eyebrow. Only populated by
   *  `getDetail`, same convention as `questions` (other mutation endpoints leave it `undefined` —
   *  the frontend never sets `claim()` from their response, only from a subsequent `getDetail`). */
  stateName?: string;
  /** DB-driven claimed-vs-allocated variance band, same source as ClaimLetterClaimContext's fields
   *  above — only populated by `getDetail`, same convention as `questions`. */
  varianceLowerPercent?: number;
  varianceUpperPercent?: number;
  /** Authoritative UI edit/submit gates — see ClaimLetterPermissions doc comment. Always populated
   *  (every endpoint that returns this summary goes through mapClaimLetterBatchDocToSummary). */
  permissions: ClaimLetterPermissions;
}

/** One row of the covering letter's recommended-ULBs table. No per-ULB date field exists on
 *  `ClaimLetterBatchUlb` (only a shared batch `createdAt`), so this row intentionally carries no
 *  date — see `ClaimLetterDocumentService`. */
export interface ClaimLetterDocumentCoveringLetterRow {
  slNo: number;
  ulbId: string;
  ulbName: string;
  /** Whole Rupees (no decimals). */
  claimAmount: number;
}

/** One row of Annexure 1 (FC Unspent Balance Disclosures). `priorFcUnspentAmount` is the ULB's
 *  unspent balance from the FC cycle named by `ClaimLetterDocumentData.priorFcCycleLabel` (14th FC
 *  for design years up to 2026-27, 15th FC thereafter) — 0 when no FC-Unspent declaration is on
 *  file for the ULB. `claimedAmount` mirrors the covering letter's claim amount for the same ULB
 *  (labelled "16th FC Allocation" on this annexure, per product decision — not a separate figure). */
export interface ClaimLetterDocumentAnnexure1Row {
  slNo: number;
  ulbId: string;
  ulbName: string;
  priorFcUnspentAmount: number;
  claimedAmount: number;
  eligible: boolean;
}

/** One column header for Annexure 2's dynamic criteria table — one per entry in
 *  `ClaimLetterUlbLevelEligibility.criteriaColumns`, i.e. one per currently-enabled ULB-bulk
 *  eligibility criterion (never a fixed set — see `ClaimLetterDocumentService`). */
export interface ClaimLetterDocumentAnnexure2Column {
  type: string;
  label: string;
  shortLabel: string;
}

/** One ULB's pass/fail against a single Annexure 2 column, paired by `type` with the matching
 *  entry in `ClaimLetterDocumentData.annexure2Columns`. */
export interface ClaimLetterDocumentAnnexure2CriterionResult {
  type: string;
  met: boolean;
}

/** One row of Annexure 2 (City-wise Eligibility Conditions) — `criteria` has exactly one entry per
 *  `ClaimLetterDocumentData.annexure2Columns`, in the same order, for every row. */
export interface ClaimLetterDocumentAnnexure2Row {
  slNo: number;
  ulbId: string;
  ulbName: string;
  criteria: ClaimLetterDocumentAnnexure2CriterionResult[];
}

/** Full content for the claim letter document (Preview Template dialog + Download Template PDF) —
 *  the live, batch-specific letter a State prints, signs, and re-uploads via `signedClaimFile`. See
 *  `ClaimLetterDocumentService.getDocumentData()`. */
export interface ClaimLetterDocumentData {
  refNo: string;
  letterDate: string;
  stateName: string;
  departmentName: string;
  designYearLabel: string;
  installment: ClaimLetterInstallment;
  batchNumber: ClaimLetterBatchNumber;
  /** "14th FC" or "15th FC" — see `ClaimLetterDocumentAnnexure1Row.priorFcUnspentAmount`. */
  priorFcCycleLabel: string;
  subjectLine: string;
  introParagraph: string;
  closingParagraph: string;
  signatoryName: string;
  signatoryDesignation: string;
  coveringLetterRows: ClaimLetterDocumentCoveringLetterRow[];
  /** Whole Rupees (no decimals) — sum of every `coveringLetterRows[].claimAmount`. */
  totalClaimAmount: number;
  annexure1Rows: ClaimLetterDocumentAnnexure1Row[];
  annexure2Columns: ClaimLetterDocumentAnnexure2Column[];
  annexure2Rows: ClaimLetterDocumentAnnexure2Row[];
}
