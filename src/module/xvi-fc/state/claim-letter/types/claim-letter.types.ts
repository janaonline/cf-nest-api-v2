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
import type {
  ClaimLetterExemptionNote,
  ClaimLetterFinancialOverview,
} from '../services/eligibility/claim-letter-eligibility.service';
import type { ClaimLetterPermissions } from '../helpers/claim-letter-permissions.helpers';

/** Display-ready ULB-options picker row (matches the FC Unspent picker-dialog UX). */
export interface ClaimLetterUlbOption {
  ulbId: string;
  ulbName: string;
  censusCode: string | null;
  sbCode: string | null;
  /** Whole Rupees; null when the ULB has no active Devolution allocation row. */
  allocationAmount: number | null;
  eligible: boolean;
  ineligibleReasonCode: string | null;
  /** Names the failing form(s); only for ULB_LEVEL_ELIGIBILITY_CRITERIA_NOT_MET, else null. */
  ineligibleReasonDetail: string | null;
  /** Exemptions under MoHUA review or rejected (row badges). */
  exemptionNotes: ClaimLetterExemptionNote[];
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
  /** Exemptions under MoHUA review or rejected (row badges). */
  exemptionNotes: ClaimLetterExemptionNote[];
}

/** Whole Rupees, as stored. */
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
  /** Page-header eyebrow ("16th Finance Commission · {state}"). */
  stateName: string;
  installment: ClaimLetterInstallment;
  /** "14th FC" or "15th FC" for this design year; also fills {{priorFcCycleLabel}} in checklist copy. */
  priorFcCycleLabel: PriorFcCycleLabel;
  stateLevelGate: {
    passed: boolean;
    sources: EligibilityEvaluationResult[];
  };
  expectedUlbCount: number;
  batchSlotsUsed: number;
  batchSlotsMax: number;
  /** Slot a new draft would take now (allocateBatchNumber's first-free rule); null when all are used. */
  nextBatchNumber: ClaimLetterBatchNumber | null;
  /** State-wide, so it exists before the first batch (unlike a batch's own financialSummary). */
  financialOverview: {
    totalInstallmentAllocation: number;
    totalAlreadyAcknowledged: number;
    totalClaimInProgress: number;
    totalClaimInDraft: number;
    availableToClaim: number;
  };
  /** ULB-owned criteria (e.g. SLB, Annual Accounts): informational, never part of stateLevelGate. */
  ulbLevelCriteria: {
    displayLabel?: string;
    displayDescription?: string;
    tally: UlbEligibilityTally;
  }[];
  /** ULBs eligible or exempt on every ULB-bulk criterion. Ignores allocation and locks, so it is not
   *  the picker's count of pickable ULBs. */
  ulbReadiness: {
    eligible: number;
    total: number;
  };
  /** Expected ULBs in no batch, eligible or not; the final batch cannot be submitted while any remain. */
  remainingUlbCount: number;
  /** The one active batch (ADR 0004); null when a new claim can start. */
  activeBatchNumber: number | null;
}

/** Lean sibling of ClaimLetterEligibilitySummary for the create/edit page (no gate or ULB-level evaluation). */
export interface ClaimLetterClaimContext {
  stateName: string;
  expectedUlbCount: number;
  batchSlotsUsed: number;
  batchSlotsMax: number;
  nextBatchNumber: ClaimLetterBatchNumber | null;
  financialOverview: ClaimLetterFinancialOverview;
  remainingUlbCount: number;
  /** Claimed-vs-allocated band from formjson meta, with code fallbacks (ClaimLetterFormJsonService). */
  varianceLowerPercent: number;
  varianceUpperPercent: number;
  /** PREPARE_GRANT_LETTERS and no active batch; stands in for permissions.canEdit before a batch exists. */
  canCreate: boolean;
  /** Set when an active batch is what makes canCreate false. */
  createBlockedReason: string | null;
}

/** Which final claim letter the page shows: the live merge of a draft, or the copy that was submitted. */
export type ClaimLetterFinalStage = 'DRAFT' | 'SUBMITTED';

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
  /** null: no final claim letter to show (no signed letter yet, abandoned, or blocked by another batch). */
  finalClaimLetterStage: ClaimLetterFinalStage | null;
  financialSummary: ClaimLetterFinancialSummaryDisplay;
  /** Sent back as `expectedRevision` on `PATCH .../draft`. */
  revision: number;
  submittedAt: Date | null;
  resolvedAt: Date | null;
  supersedes: string | null;
  supersededBy: string | null;
  createdAt: Date;
  /** getDetail only: formjson 26 fields except the letter details (GET .../letter-details has those). */
  questions?: FieldConfig[];
  /** getDetail only. */
  stateName?: string;
  /** getDetail only: the claimed-vs-allocated band, as in ClaimLetterClaimContext. */
  varianceLowerPercent?: number;
  /** getDetail only. */
  varianceUpperPercent?: number;
  /** getDetail only: mandatory letter details saved and valid (Submit needs them). */
  letterDetailsComplete?: boolean;
  /** getDetail only: ULBs in this draft relying on an exemption still under MoHUA review (Submit
   *  confirm); 0 once it is no longer a draft. */
  exemptionUnderReviewUlbCount?: number;
  /** getDetail only: State forms whose Entire State exemption request is still under MoHUA review
   *  (Submit confirm); empty once it is no longer a draft. */
  stateExemptionsUnderReview?: string[];
  /** Another batch is active (ADR 0004): preview, download, letter details and submit are blocked.
   *  Populated by `getDetail` and `listHistory`. */
  blockedByBatchNumber?: number | null;
  blockedReason?: string | null;
  permissions: ClaimLetterPermissions;
}
