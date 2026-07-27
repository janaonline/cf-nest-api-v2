import type {
  ClaimLetterAssemblyStatus,
  ClaimLetterBatchNumber,
  ClaimLetterInstallment,
} from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import type { EligibilityEvaluationResult } from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';

/** Display-ready ULB-options picker row (matches the FC Unspent picker-dialog UX — plan §6.1). */
export interface ClaimLetterUlbOption {
  ulbId: string;
  ulbName: string;
  censusCode: string | null;
  sbCode: string | null;
  /** Crore-denominated, display-ready — null when the ULB has no active Devolution allocation row. */
  allocationAmount: number | null;
  eligible: boolean;
  ineligibleReasonCode: string | null;
}

/** Display-ready selected-ULB table row (matches the FC Unspent Yes-branch table — plan §6.2). */
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

/** Crore-denominated — the same unit this is stored in, passed through unconverted (plan §8). */
export interface ClaimLetterFinancialSummaryDisplay {
  totalInstallmentAllocation: number;
  totalAlreadyAcknowledged: number;
  selectedAllocation: number;
  currentSelectedClaim: number;
  remainingIfAcknowledged: number;
}

export interface ClaimLetterEligibilitySummary {
  installment: ClaimLetterInstallment;
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
  };
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
}
