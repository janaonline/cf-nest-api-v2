import { FormStatusType } from 'src/common/constants/form-status.constants';
import { RowStatusType } from 'src/common/constants/row-status.constants';

// ─── formJson.claimEligibility config (brain §7.2) ─────────────────────────────

export type ClaimEligibilityOwnerLevel = 'STATE' | 'ULB';
export type ClaimEligibilityEvaluationLevel = 'FORM' | 'ROW' | 'FORM_AND_ROW';
export type ClaimEligibilityYearScope = 'CURRENT_DESIGN_YEAR' | 'SUBMISSION_PERIOD_SINGLETON';
export type ClaimEligibilityInstallment = 1 | 2;

/**
 * Controlled evaluator vocabulary (brain §7.3). Only 'FORM_STATUS' is implemented in V1
 * (ClaimEligibilityEvaluatorService) — the other 4 are reserved names for future sources
 * (Elected Body, FC Unspent, PFMS) so configuring them later is additive, not a schema change.
 */
export type ClaimEvaluationType =
  | 'FORM_STATUS'
  | 'FORM_AND_ROW_STATUS'
  | 'ROW_STATUS_AND_FIELDS'
  | 'BRANCH_WITH_OPTIONAL_ROWS'
  | 'ONE_TIME_FORM_STATUS';

/** Controlled workflow actions (brain §7.4) — validated against a server allowlist, never executable config. */
export type ClaimWorkflowAction =
  | 'NO_ACTION'
  | 'SET_FORM_STATUS'
  | 'SET_ROW_STATUS'
  | 'MARK_DEPENDENT_ROWS_NEEDS_UPDATE'
  | 'INVALIDATE_CLAIM_DRAFTS';

export interface ClaimWorkflowActionConfig {
  action: ClaimWorkflowAction;
  targetFormStatus?: FormStatusType;
  targetRowStatus?: RowStatusType;
}

export interface ClaimEligibilitySourceFieldMapping {
  designYear: string;
  state?: string;
  ulb?: string;
  currentFormStatus: string;
  isActive?: string;
  revision?: string;
  datasetVersion?: string;
}

export interface ClaimEligibilitySource {
  collection?: string;
  parentCollection?: string;
  rowCollection?: string;
  fields?: ClaimEligibilitySourceFieldMapping;
  parentFields?: Record<string, string>;
  rowFields?: Record<string, string>;
}

export interface ClaimEligibilityEvaluatorConfig {
  type: ClaimEvaluationType;
  /**
   * Free-form, evaluator-specific config bag. Devolution's installment scoping is expressed
   * here as `{ installmentField: 'installment' }` rather than adding an `installment` key to
   * `source.fields` (brain §7.2 doesn't define one there).
   */
  config?: Record<string, unknown>;
}

export interface ClaimEligibilityExemptionConfig {
  allowed: boolean;
  targetLevel?: 'FORM_STATUS' | 'ROW_ELIGIBILITY';
}

export interface ClaimEligibilityConfig {
  enabled: boolean;
  ruleVersion: number;

  /** Short human-readable name for this criterion (e.g. "Devolution Formula"), shown in the claim
   *  letter eligibility checklist. Optional — the frontend falls back to a humanized `formType`
   *  when absent, so an unconfigured source never renders blank. */
  displayLabel?: string;
  /** One-line requirement statement (e.g. "Devolution Formula must be submitted by the state."),
   *  shown alongside the pass/fail indicator regardless of current result — same wording whether
   *  passing or failing, only the tick/cross changes. */
  displayDescription?: string;

  ownerLevel: ClaimEligibilityOwnerLevel;
  evaluationLevel: ClaimEligibilityEvaluationLevel;
  yearScope: ClaimEligibilityYearScope;
  applicableInstallments: ClaimEligibilityInstallment[];

  acceptedFormStatuses: FormStatusType[];
  acceptedRowStatuses?: RowStatusType[];

  source: ClaimEligibilitySource;
  evaluator: ClaimEligibilityEvaluatorConfig;
  exemption: ClaimEligibilityExemptionConfig;

  approval: ClaimWorkflowActionConfig;
  rejection: ClaimWorkflowActionConfig;
  dependentActions?: ClaimWorkflowActionConfig[];
}

// ─── Restricted, versioned evidence (plan §4.1 — never an unbounded Record<string, unknown>) ───

/**
 * Evidence produced by the 'FORM_STATUS' evaluator — the only evaluator implemented in V1.
 * `resolvedFormStatus`/`sourceFormDocumentId` are nullable (not optional — always present, may be
 * null) to represent the legitimate case where the source form document doesn't exist yet (e.g. a
 * State hasn't started Devolution at all) — this never gets frozen into a claim snapshot (only
 * PASSED/EXEMPTED results are, see ClaimEligibilitySourceSnapshot below), so it only appears in
 * the live EligibilityEvaluationResult's FAILED branch.
 */
export interface FormStatusEvidenceV1 {
  evidenceVersion: 1;
  resolvedFormStatus: FormStatusType | null;
  acceptedFormStatuses: FormStatusType[];
  sourceFormDocumentId: string | null;
  evaluatedAt: string; // ISO 8601
}

/**
 * Union of every evaluator's evidence shape. Grows by one member per new evaluator type
 * (brain §7.3) — never widens back to an unrestricted bag.
 */
export type ClaimEligibilityEvidence = FormStatusEvidenceV1;

/** Defensive cap enforced by ClaimEligibilityEvaluatorService — one misconfigured future
 *  evaluator can't inflate child-document size across a 700-ULB batch. */
export const CLAIM_ELIGIBILITY_EVIDENCE_MAX_SERIALIZED_BYTES = 2048;

// ─── Evaluation result (brain §12.3) ────────────────────────────────────────────

export type ClaimEligibilityResult = 'PASSED' | 'EXEMPTED' | 'FAILED';

export interface EligibilityEvaluationResult {
  formId: number;
  formJsonId: string;
  ruleVersion: number;
  formType: string;

  /** Copied from `ClaimEligibilityConfig.displayLabel`/`displayDescription` at evaluation time —
   *  see there for what these mean. Absent when the source config didn't set them. */
  displayLabel?: string;
  displayDescription?: string;

  ownerLevel: ClaimEligibilityOwnerLevel;
  evaluationLevel: ClaimEligibilityEvaluationLevel;

  // Nullable (not optional): null represents the legitimate "source form document doesn't exist
  // yet" case, only ever seen in a FAILED result — never frozen into a claim snapshot.
  formDocumentId: string | null;
  rowDocumentId?: string | null;

  statusAtEvaluation: FormStatusType | null;
  rowStatusAtEvaluation?: RowStatusType | null;
  revision?: number | null;
  datasetVersion?: number | null;

  result: ClaimEligibilityResult;
  exemptionId?: string | null;
  reasonCode: string;

  evidence: ClaimEligibilityEvidence;
}

// ─── Frozen claim snapshot (brain §14.3) ────────────────────────────────────────

/** Snapshot stored on the claim parent/child — a 'FAILED' result never gets frozen into a claim. */
export type ClaimEligibilitySnapshotResult = 'PASSED' | 'EXEMPTED';

export interface ClaimEligibilitySourceSnapshot {
  formId: number;
  formJsonId: string;
  ruleVersion: number;
  formType: string;

  formDocumentId: string;
  rowDocumentId?: string | null;

  statusAtEvaluation: FormStatusType;
  rowStatusAtEvaluation?: RowStatusType | null;
  revision?: number | null;
  datasetVersion?: number | null;

  result: ClaimEligibilitySnapshotResult;
  exemptionId?: string | null;
  reasonCode: string;

  evidence: ClaimEligibilityEvidence;
}
