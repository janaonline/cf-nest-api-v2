import { FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL } from '../constants/fc-unspent-declaration.constants';

export type PriorFcCycleLabel = '14th FC' | '15th FC';

/**
 * Resolves the display label for whichever Finance Commission cycle precedes the current XVI FC
 * design year — "14th FC" for 2026-27/2027-28, "15th FC" from 2028-29 onward, per
 * `FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL`. Falls back to '14th FC' for an unmapped year, same
 * fallback every other `FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL[...]` lookup in this module uses.
 *
 * Single source of truth for this text — read by both the claim-letter document (Annexure 1) and
 * the claim-letter eligibility-summary response (`ClaimLetterEligibilitySummary.priorFcCycleLabel`,
 * consumed by the State's Requirements page), so what a state's checklist says and what its actual
 * signed Claim Letter says can never disagree on which FC cycle is meant.
 */
export function resolvePriorFcCycleLabel(designYearLabel: string): PriorFcCycleLabel {
  const applicableFc = FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL[designYearLabel] ?? '14TH_FC';
  return applicableFc === '15TH_FC' ? '15th FC' : '14th FC';
}

/**
 * Prose form of {@link resolvePriorFcCycleLabel} — `'14th FC'` -> `'14th Finance Commission'` —
 * for document text that spells the cycle name out rather than abbreviating it (e.g. the FC
 * Unspent Declaration document's subject line and body paragraphs). Composes over
 * `resolvePriorFcCycleLabel` rather than re-deriving the year -> FC mapping, so that function
 * stays the single source of truth for which cycle applies to a given design year.
 */
export function resolvePriorFcCycleFullLabel(designYearLabel: string): string {
  return resolvePriorFcCycleLabel(designYearLabel).replace(/FC$/, 'Finance Commission');
}
