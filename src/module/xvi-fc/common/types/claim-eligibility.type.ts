import { FormStatusType } from 'src/common/constants/form-status.constants';

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
  targetRowStatus?: FormStatusType;
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

// ─── Per-ULB bulk evaluation (ownerLevel: 'ULB') ────────────────────────────────

export type UlbEligibilityBucket = 'ELIGIBLE' | 'INELIGIBLE' | 'EXEMPTED';

export interface UlbEligibilityTally {
  eligible: number;
  ineligible: number;
  exempted: number;
  total: number;
}

/** One ULB's resolved row evidence for a `FORM_AND_ROW` source — lets callers (claim-letter
 *  assembly) freeze a real per-ULB `ClaimEligibilitySourceSnapshot` entry without re-querying, by
 *  reusing the same bulk fetch `evaluateUlbBulkRowStatus` already runs to compute `perUlb`. */
export interface RowEligibilityEvidence {
  bucket: UlbEligibilityBucket;
  rowDocumentId: string | null;
  rowStatusAtEvaluation: FormStatusType | null;
  /** Elected Body's dataset-versioned rows; null for FC Unspent (no dataset-versioning concept). */
  datasetVersion: number | null;
}

/**
 * Config shape for the 'ROW_STATUS_AND_FIELDS' evaluator, read out of the free-form
 * `evaluator.config` bag (same convention already used for Devolution's `installmentField`) —
 * kept as a documented interface here rather than untyped `Record<string, unknown>` reads
 * scattered through the evaluator, given how many fields this one needs.
 */
export interface ClaimEligibilityRowMatchConfig {
  rowStatusField: string;
  rowEligibleValues: unknown[];
  /** Not consulted at runtime (matches `acceptedFormStatuses`'s existing accept-list-only
   *  convention — anything not eligible/exempted defaults to ineligible) — documentation only,
   *  so a config reader can see every value the field can hold without checking the schema. */
  rowIneligibleValues?: unknown[];
  /** Omitted/empty when a source has no exemption-shaped value (e.g. FC Unspent's boolean). */
  rowExemptedValues?: unknown[];
  /** What to conclude about a ULB with no active/current row at all — explicit per-source, no
   *  silent default. E.g. FC Unspent: 'ELIGIBLE', since "no unspent balance to report" isn't a
   *  problem; a source where every ULB is expected to always have a row would use 'INELIGIBLE'. */
  defaultWhenNoRow: 'ELIGIBLE' | 'INELIGIBLE';
  /** Optional second AND-condition, read by `ClaimEligibilityEvaluatorService.bucketRowValue` —
   *  when both are set, a row must be in an accepted FORM_STATUS *and* satisfy the value mapping
   *  above to count as ELIGIBLE/EXEMPTED; failing the FORM_STATUS check alone makes it INELIGIBLE,
   *  no exemption bypass. Dynamic and config-driven, same as `acceptedFormStatuses` for the parent
   *  form — editing `rowAcceptedFormStatuses` changes behavior with no code change. */
  rowFormStatusField?: string;
  rowAcceptedFormStatuses?: number[];
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
  /** Compact form of `displayLabel` for column-header-style UIs (e.g. "AFS" for "Audited Financial
   *  Statement") — today only consumed by the claim letter's Annexure 2 city-conditions table.
   *  Optional; falls back to `displayLabel` when unset, so an unconfigured source still renders a
   *  meaningful (if longer) header rather than blank. */
  shortLabel?: string;

  ownerLevel: ClaimEligibilityOwnerLevel;
  evaluationLevel: ClaimEligibilityEvaluationLevel;
  yearScope: ClaimEligibilityYearScope;
  applicableInstallments: ClaimEligibilityInstallment[];

  acceptedFormStatuses: FormStatusType[];
  acceptedRowStatuses?: FormStatusType[];

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
  rowStatusAtEvaluation?: FormStatusType | null;
  revision?: number | null;
  datasetVersion?: number | null;

  result: ClaimEligibilityResult;
  exemptionId?: string | null;
  reasonCode: string;

  evidence: ClaimEligibilityEvidence;

  /** Populated only for `evaluationLevel: 'FORM_AND_ROW'` sources (Elected Body, FC Unspent) —
   *  the per-ULB tally behind this same requirement, supplementary to `result` above (which stays
   *  driven purely by the state's own form-submission status). `undefined` for pure-form sources
   *  (SFC, Devolution), so their existing rendering is untouched. */
  ulbBreakdown?: UlbEligibilityTally;
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
  rowStatusAtEvaluation?: FormStatusType | null;
  revision?: number | null;
  datasetVersion?: number | null;

  result: ClaimEligibilitySnapshotResult;
  exemptionId?: string | null;
  reasonCode: string;

  evidence: ClaimEligibilityEvidence;
}
