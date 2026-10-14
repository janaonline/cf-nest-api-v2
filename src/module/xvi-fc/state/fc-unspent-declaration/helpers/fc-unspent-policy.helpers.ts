import type { ApplicableFc } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import { FC_UNSPENT_ELIGIBILITY_THRESHOLD_META_KEY } from '../constants/fc-unspent-declaration.constants';

/** Key read off `formJson.meta` to override the FC-cycle default policy for one design year. */
export const FC_UNSPENT_POLICY_META_KEY = 'unspentPolicy';

/**
 * How a ULB's FC Unspent row decides its `eligibility` flag (read by Claim Letter eligibility).
 *
 * - `NO_UNSPENT_ALLOWED`: eligible only when the ULB has NO unspent balance of either kind (applicable-FC
 *   unspent and previous unspent). Any balance makes it ineligible. Needs no Devolution allocation.
 * - `MAX_PERCENT_OF_ALLOCATION`: the original rule, `unspent / devolution allocation * 100 <= thresholdPercent`.
 *   Needs the ULB's Devolution allocation.
 */
export type FcUnspentEligibilityRule =
  | { type: 'NO_UNSPENT_ALLOWED' }
  | { type: 'MAX_PERCENT_OF_ALLOCATION'; thresholdPercent: number };

/**
 * The per-design-year rules of the FC Unspent Declaration. One object answers every "does this form
 * depend on Devolution Formula, and how is eligibility decided" question, so no service needs a
 * year- or FC-cycle-specific `if`.
 */
export interface FcUnspentPolicy {
  /** True: edit/save/submit are gated on Devolution Installment 1, the ULB picker is sourced from its
   *  dataset, and each row snapshots its allocation. False: the form is fully independent of Devolution. */
  devolutionLinked: boolean;
  eligibilityRule: FcUnspentEligibilityRule;
}

/**
 * Defaults keyed by the FC cycle the year's unspent balance belongs to (the year -> cycle map is
 * `FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL`), not by year.
 *
 * - 14th FC (Years 1-2): independent of Devolution; any unspent balance makes the ULB ineligible.
 * - 15th FC (Years 3-5): today's linked behaviour, kept unchanged until the business confirms the rules
 *   for those years. The threshold here is the fallback; `meta.eligibilityThresholdPercent` /
 *   `meta.unspentPolicy` override it per design year.
 */
export const FC_UNSPENT_POLICY_DEFAULTS_BY_FC: Readonly<Record<ApplicableFc, FcUnspentPolicy>> = {
  '14TH_FC': { devolutionLinked: false, eligibilityRule: { type: 'NO_UNSPENT_ALLOWED' } },
  '15TH_FC': { devolutionLinked: true, eligibilityRule: { type: 'MAX_PERCENT_OF_ALLOCATION', thresholdPercent: 0 } },
};

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseEligibilityRule(raw: unknown): FcUnspentEligibilityRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const rule = raw as Record<string, unknown>;
  if (rule['type'] === 'NO_UNSPENT_ALLOWED') return { type: 'NO_UNSPENT_ALLOWED' };
  if (rule['type'] === 'MAX_PERCENT_OF_ALLOCATION' && isNonNegativeNumber(rule['thresholdPercent'])) {
    return { type: 'MAX_PERCENT_OF_ALLOCATION', thresholdPercent: rule['thresholdPercent'] };
  }
  return null;
}

/**
 * Resolves the effective policy for a design year. Precedence:
 * 1. `formJson.meta.unspentPolicy` (any valid part overrides the matching part of the default),
 * 2. legacy `formJson.meta.eligibilityThresholdPercent` (only feeds the percent-of-allocation rule),
 * 3. the FC-cycle default.
 * Malformed meta never throws: the invalid part falls back to the next level.
 */
export function resolveFcUnspentPolicy(applicableFc: ApplicableFc, meta?: Record<string, unknown>): FcUnspentPolicy {
  const defaults = FC_UNSPENT_POLICY_DEFAULTS_BY_FC[applicableFc];
  const override = meta?.[FC_UNSPENT_POLICY_META_KEY];
  const overrideObject = override && typeof override === 'object' ? (override as Record<string, unknown>) : {};

  const devolutionLinked =
    typeof overrideObject['devolutionLinked'] === 'boolean'
      ? overrideObject['devolutionLinked']
      : defaults.devolutionLinked;

  let eligibilityRule = parseEligibilityRule(overrideObject['eligibilityRule']);
  if (!eligibilityRule) {
    const legacyThreshold = meta?.[FC_UNSPENT_ELIGIBILITY_THRESHOLD_META_KEY];
    if (defaults.eligibilityRule.type === 'MAX_PERCENT_OF_ALLOCATION') {
      eligibilityRule = {
        type: 'MAX_PERCENT_OF_ALLOCATION',
        thresholdPercent: isNonNegativeNumber(legacyThreshold)
          ? legacyThreshold
          : defaults.eligibilityRule.thresholdPercent,
      };
    } else {
      eligibilityRule = defaults.eligibilityRule;
    }
  }

  return { devolutionLinked, eligibilityRule };
}

/** The percent threshold shown to clients: the rule's own for the percent rule, otherwise 0 (no unspent allowed). */
export function policyThresholdPercent(policy: FcUnspentPolicy): number {
  return policy.eligibilityRule.type === 'MAX_PERCENT_OF_ALLOCATION' ? policy.eligibilityRule.thresholdPercent : 0;
}

/**
 * Decides one row's `eligibility`. `allocationPerc` is `null` when the form is not Devolution-linked.
 * A percent-of-allocation rule without an allocation percent cannot be satisfied, so it is ineligible
 * (the row service rejects such a row earlier with `noAllocation`; this is only a safe default).
 *
 * A draft row whose figures have not both been entered yet (`null`) is never eligible: eligibility is
 * only meaningful for a complete row, and final submit (which requires both) recomputes it.
 */
export function evaluateRowEligibility(
  rule: FcUnspentEligibilityRule,
  row: { unspentAmount: number | null; previousFcUnspentBalance: number | null },
  allocationPerc: number | null,
): boolean {
  if (row.unspentAmount === null || row.previousFcUnspentBalance === null) return false;
  if (rule.type === 'NO_UNSPENT_ALLOWED') return row.unspentAmount === 0 && row.previousFcUnspentBalance === 0;
  return allocationPerc !== null && allocationPerc <= rule.thresholdPercent;
}
