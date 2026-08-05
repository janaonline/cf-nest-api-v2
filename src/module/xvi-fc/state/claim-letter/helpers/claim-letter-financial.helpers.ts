import type { ClaimLetterFinancialSummaryDisplay } from '../types/claim-letter.types';

/**
 * Devolution Formula — and every other xvi-fc form — stores money as a Crore-denominated decimal
 * float, and so does Claim Letter: no paise/rupee conversion happens at the storage boundary,
 * confirmed against devolution-formula.constants.ts's Excel column labels (e.g. "Installment 2
 * Amount (Cr.)"). The API response is a direct passthrough of the stored value; the UI just
 * appends "Cr." to it.
 *
 * Plain float summation/subtraction on these values can still drift by a tiny epsilon across many
 * operations, so anywhere that must be exact — the ±10% variance boundary, financial-totals
 * cross-checks — scales to an integer internally before comparing. This scaling is purely a
 * computation aid: it is never persisted, never returned, and never exposed outside this file.
 */
const EXACT_COMPARISON_SCALE = 1_000_000_000; // paise-per-crore, reused here only for precision

function scaleForExactMath(amountInCrore: number): number {
  return Math.round(amountInCrore * EXACT_COMPARISON_SCALE);
}

/**
 * Fallback defaults, used only when a design year's form-json document has no
 * `meta.varianceLowerPercent`/`meta.varianceUpperPercent` override (see
 * CLAIM_LETTER_VARIANCE_LOWER_META_KEY/CLAIM_LETTER_VARIANCE_UPPER_META_KEY). Never read directly
 * for the gating computation — go through ClaimLetterFormJsonService.loadVarianceConfig().
 */
export const CLAIM_LETTER_VARIANCE_LOWER_PERCENT = 90;
export const CLAIM_LETTER_VARIANCE_UPPER_PERCENT = 110;

/** Keys read off `formJson.meta` to override the two constants above, per design year. */
export const CLAIM_LETTER_VARIANCE_LOWER_META_KEY = 'varianceLowerPercent';
export const CLAIM_LETTER_VARIANCE_UPPER_META_KEY = 'varianceUpperPercent';

/**
 * Claimed-vs-allocated variance check, done as exact integer arithmetic (both sides scaled the
 * same way before comparing) so the boundary is never subject to floating-point rounding.
 * `lowerPercent`/`upperPercent` are resolved by the caller (ClaimLetterFormJsonService), never
 * hardcoded here.
 */
export function isClaimedAmountWithinVariance(
  allocatedAmount: number,
  claimedAmount: number,
  lowerPercent: number,
  upperPercent: number,
): boolean {
  const allocatedScaled = scaleForExactMath(allocatedAmount);
  const claimedScaled = scaleForExactMath(claimedAmount);
  return claimedScaled * 100 >= allocatedScaled * lowerPercent && claimedScaled * 100 <= allocatedScaled * upperPercent;
}

/** Exact (scaled-integer) subtraction — avoids float drift on the stored difference amount. */
export function computeDifferenceAmount(allocatedAmount: number, claimedAmount: number): number {
  return (scaleForExactMath(claimedAmount) - scaleForExactMath(allocatedAmount)) / EXACT_COMPARISON_SCALE;
}

/**
 * 1 basis point = 0.01%. Division is unavoidable here (percentage is inherently a ratio) — this
 * value is for display only; backend ±10% validation never depends on it, only on the exact
 * integer comparison in isClaimedAmountWithinVariance.
 */
export function computeDifferencePercentageBasisPoints(allocatedAmount: number, claimedAmount: number): number {
  if (allocatedAmount === 0) return 0;
  return Math.round(((claimedAmount - allocatedAmount) * 10000) / allocatedAmount);
}

/** Exact (scaled-integer) summation — avoids cumulative float drift across many additions, so a
 *  total computed this way stays bit-for-bit reproducible against the same inputs summed again
 *  elsewhere (e.g. the create-time total vs. the verify-time re-sum over persisted children). */
export function sumAmountsExactly(amounts: readonly number[]): number {
  const scaledSum = amounts.reduce((sum, amount) => sum + scaleForExactMath(amount), 0);
  return scaledSum / EXACT_COMPARISON_SCALE;
}

/** Exact equality on two Crore amounts — scales both sides the same way `sumAmountsExactly` does,
 *  so a sum produced by that helper always compares equal to an independently-stored total that's
 *  supposed to match it. */
export function amountsAreEqual(a: number, b: number): boolean {
  return scaleForExactMath(a) === scaleForExactMath(b);
}

/** File base name format: `CF_<statecode>_<designyear>_<installmentno>`. */
export function buildClaimLetterFileBaseName(stateCode: string, designYearLabel: string, installment: 1 | 2): string {
  return `CF_${stateCode}_${designYearLabel}_${installment}`;
}

/**
 * Ref No. format: `CL/<statecode>/<designyear>/<installment>-<batchnumber>`. Computed live from
 * fields that are already unique per batch — `{state, year, installment, batchNumber}` is
 * DB-unique-indexed on `ClaimLetterBatch` — so this is deterministic and needs no stored counter;
 * the same batch always yields the same Ref No. across repeated Preview/Download calls.
 */
export function buildClaimLetterRefNo(params: {
  stateCode: string;
  designYearLabel: string;
  installment: 1 | 2;
  batchNumber: number;
}): string {
  const { stateCode, designYearLabel, installment, batchNumber } = params;
  return `CL/${stateCode}/${designYearLabel}/${installment}-${batchNumber}`;
}

export type { ClaimLetterFinancialSummaryDisplay as ClaimLetterFinancialSummaryAmounts };
