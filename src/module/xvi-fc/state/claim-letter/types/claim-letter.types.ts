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
  ClaimLetterClaimedBatch,
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
  /** Set when the ULB is locked in another batch (reason ALREADY_LOCKED_IN_ANOTHER_CLAIM). */
  claimedInBatch: ClaimLetterClaimedBatch | null;
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
  /** The State-level gate, the same on every row; when false, every row is ineligible for a reason
   *  that removing ULBs cannot fix. */
  stateGatePassed: boolean;
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
  /** Expected ULBs in no letter, eligible or not; once every place is taken, the last draft (no other draft open)
   *  can't be submitted while any remain (ADR 0009). */
  remainingUlbCount: number;
  /** formjson 26 `meta.claimAmountEditable`; off means each ULB's claim is its allocation (ADR 0006). */
  claimAmountEditable: boolean;
}

/** Lean sibling of ClaimLetterEligibilitySummary for the create/edit page (no gate or ULB-level evaluation). */
export interface ClaimLetterClaimContext {
  stateName: string;
  expectedUlbCount: number;
  batchSlotsUsed: number;
  batchSlotsMax: number;
  /** Open drafts now; a new letter that takes the last place with none open is the last draft (ADR 0009). */
  openDraftCount: number;
  nextBatchNumber: ClaimLetterBatchNumber | null;
  financialOverview: ClaimLetterFinancialOverview;
  remainingUlbCount: number;
  /** As in ClaimLetterEligibilitySummary. */
  claimAmountEditable: boolean;
  /** Claimed-vs-allocated band from formjson meta, with code fallbacks (ClaimLetterFormJsonService);
   *  applies only while claimAmountEditable is on. */
  varianceLowerPercent: number;
  varianceUpperPercent: number;
  /** PREPARE_GRANT_LETTERS and a free place under the letter cap; stands in for permissions.canEdit before a
   *  letter exists. */
  canCreate: boolean;
  /** Set when every place is taken (formjson 26 `meta.maxClaimLetters`), for a user with PREPARE_GRANT_LETTERS only. */
  createBlockedReason: string | null;
}

/** Which final claim letter the page shows: the live merge of a draft, or the copy that was submitted. */
export type ClaimLetterFinalStage = 'DRAFT' | 'SUBMITTED';

export interface ClaimLetterBatchSummary {
  claimLetterId: string;
  installment: ClaimLetterInstallment;
  batchNumber: ClaimLetterBatchNumber;
  /** Above 0 for a letter built in a slot a returned letter held: the UI shows "2-R1". */
  resubmissionNumber: number;
  version: number;
  currentFormStatus: number;
  currentFormStatusLabel: string;
  assemblyStatus: ClaimLetterAssemblyStatus;
  ulbCount: number;
  isAbandoned: boolean;
  hasSignedFile: boolean;
  /** null: no final claim letter to show (no signed letter yet, or abandoned). Only getDetail also clears it while a
   *  State-level condition fails; history doesn't read the State gate and can still show DRAFT. */
  finalClaimLetterStage: ClaimLetterFinalStage | null;
  financialSummary: ClaimLetterFinancialSummaryDisplay;
  /** Sent back as `expectedRevision` on `PATCH .../draft`. */
  revision: number;
  submittedAt: Date | null;
  resolvedAt: Date | null;
  supersedes: string | null;
  supersededBy: string | null;
  createdAt: Date;
  /** Mongo's last write to the letter; History sorts by it and shows it as "Last activity". */
  updatedAt: Date;
  /** The SO's (or MoHUA's) remark when the letter was returned; null otherwise. */
  mohuaRemarks: string | null;
  /** Set when the letter was returned because another letter's State form was returned (ADR 0009). */
  returnedWithNote: string | null;
  /** getDetail only: formjson 26 fields except the letter details (GET .../letter-details has those). */
  questions?: FieldConfig[];
  /** getDetail only. */
  stateName?: string;
  /** getDetail only: as in ClaimLetterClaimContext. */
  claimAmountEditable?: boolean;
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
  /** getDetail only, drafts: a State-level condition fails, so letter details and preview, the signed-letter
   *  upload, the final claim letter and submit are unavailable (ADR 0009). */
  blockedReason?: string | null;
  /** getDetail only, drafts: banner after another letter's State form return, or while State conditions fail. */
  stateFormNotice?: string | null;
  /** getDetail only, drafts: every place is taken and no other draft is open, so every ULB must be in a letter
   *  before this one can be submitted (the last-draft rule, ADR 0009). */
  isLastPlace?: boolean;
  /** getDetail only, the last draft: expected ULBs in no letter, read with `isLastPlace`; null otherwise. */
  remainingUlbCount?: number | null;
  /** getDetail only, a letter the SO returned itself: what went back. null otherwise, also for a letter returned
   *  with another letter's State form (`returnedWithNote` explains that one). */
  returnSummary?: ClaimLetterReturnSummary | null;
  permissions: ClaimLetterPermissions;
}

/** What a return reopened, for the State's returned-letter box and red ULB rows. */
export interface ClaimLetterReturnSummary {
  /** State forms reopened; `ulbCount` > 0 when the form went back through its ULB rows. */
  stateForms: { formId: number; name: string; ulbCount: number }[];
  /** Returned ULBs, by name: the forms (or exemptions) reopened and the SO's remark. */
  ulbs: ClaimLetterReturnedUlb[];
}

export interface ClaimLetterReturnedUlb {
  ulbId: string;
  ulbName: string;
  items: string[];
  remark: string | null;
}
