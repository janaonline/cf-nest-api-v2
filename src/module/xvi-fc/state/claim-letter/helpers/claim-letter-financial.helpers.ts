import type { ClaimLetterFinancialSummaryDisplay } from '../types/claim-letter.types';

// Amounts are whole Rupees, so integer arithmetic here is exact (module CLAUDE.md, "Money").

/** Fallback band when formjson meta has no override; read it through ClaimLetterFormJsonService. */
export const CLAIM_LETTER_VARIANCE_LOWER_PERCENT = 90;
export const CLAIM_LETTER_VARIANCE_UPPER_PERCENT = 110;

/** Keys read off `formJson.meta` to override the two constants above, per design year. */
export const CLAIM_LETTER_VARIANCE_LOWER_META_KEY = 'varianceLowerPercent';
export const CLAIM_LETTER_VARIANCE_UPPER_META_KEY = 'varianceUpperPercent';

/** Cross-multiplies instead of dividing, so the check stays exact; the percents must be whole numbers. */
export function isClaimedAmountWithinVariance(
  allocatedAmount: number,
  claimedAmount: number,
  lowerPercent: number,
  upperPercent: number,
): boolean {
  return claimedAmount * 100 >= allocatedAmount * lowerPercent && claimedAmount * 100 <= allocatedAmount * upperPercent;
}

export function computeDifferenceAmount(allocatedAmount: number, claimedAmount: number): number {
  return claimedAmount - allocatedAmount;
}

/** Display only (1 bp = 0.01%); the variance check never uses it. */
export function computeDifferencePercentageBasisPoints(allocatedAmount: number, claimedAmount: number): number {
  if (allocatedAmount === 0) return 0;
  return Math.round(((claimedAmount - allocatedAmount) * 10000) / allocatedAmount);
}

export function sumAmountsExactly(amounts: readonly number[]): number {
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

export function amountsAreEqual(a: number, b: number): boolean {
  return a === b;
}

/** File base name format: `CF_<statecode>_<designyear>_<installmentno>`. */
export function buildClaimLetterFileBaseName(stateCode: string, designYearLabel: string, installment: 1 | 2): string {
  return `CF_${stateCode}_${designYearLabel}_${installment}`;
}

/** `CL/<statecode>/<designyear>/<installment>-<batchnumber>`: built from the batch's unique key, so
 *  it is stable across calls and needs no stored counter. */
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
