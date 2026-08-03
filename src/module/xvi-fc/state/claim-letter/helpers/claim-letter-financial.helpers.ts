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

export const CLAIM_LETTER_VARIANCE_LOWER_PERCENT = 90;
export const CLAIM_LETTER_VARIANCE_UPPER_PERCENT = 110;

/**
 * ±10% claimed-vs-allocated check, done as exact integer arithmetic (both sides scaled the same
 * way before comparing) so the boundary (exactly 90% or 110%) is never subject to floating-point
 * rounding.
 */
export function isClaimedAmountWithinVariance(allocatedAmount: number, claimedAmount: number): boolean {
  const allocatedScaled = scaleForExactMath(allocatedAmount);
  const claimedScaled = scaleForExactMath(claimedAmount);
  return (
    claimedScaled * 100 >= allocatedScaled * CLAIM_LETTER_VARIANCE_LOWER_PERCENT &&
    claimedScaled * 100 <= allocatedScaled * CLAIM_LETTER_VARIANCE_UPPER_PERCENT
  );
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

/** Brain §14.9: `CF_<statecode>_<designyear>_<installmentno>`. */
export function buildClaimLetterFileBaseName(stateCode: string, designYearLabel: string, installment: 1 | 2): string {
  return `CF_${stateCode}_${designYearLabel}_${installment}`;
}

export type { ClaimLetterFinancialSummaryDisplay as ClaimLetterFinancialSummaryAmounts };
