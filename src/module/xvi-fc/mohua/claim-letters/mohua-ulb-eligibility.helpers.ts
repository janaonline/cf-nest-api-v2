import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import type { ClaimLetterCriterionDetail } from 'src/module/xvi-fc/state/claim-letter/services/eligibility/claim-letter-eligibility.service';
import {
  buildAnnexureCell,
  discretionaryExemptionText,
  FC_UNSPENT_CRITERION_TYPE,
} from 'src/module/xvi-fc/state/claim-letter/helpers/claim-letter-letter.helpers';
import { MOHUA_ULB_ELIGIBILITY_NOT_IN_LETTER } from './mohua-claim-letters.constants';
import type { GetMohuaUlbEligibilityQueryDto } from './mohua-claim-letters-query.dto';
import type { MohuaUlbEligibilityBatch, MohuaUlbEligibilityBuildRow } from './mohua-claim-letters.types';

/** Form statuses that mean the ULB has not started that form. 12 is the automatic stub for a new ULB. */
const NOT_STARTED_STATUSES: readonly number[] = [
  FORM_STATUS.NO_STATUS,
  FORM_STATUS.NOT_STARTED,
  FORM_STATUS.EXEMPTED_ACKNOWLEDGED,
];

const hasStarted = (status: number | null): boolean => status !== null && !NOT_STARTED_STATUSES.includes(status);

/** Shorter than the form label, to keep the table's cells narrow. */
const LIVE_STATUS_LABELS: Readonly<Partial<Record<number, string>>> = {
  [FORM_STATUS.RETURNED_BY_SO]: 'Returned',
};

/** One condition cell: the text, plus whole Rupees for an amount column (the page formats it in its own units). */
export interface LiveConditionCell {
  text: string;
  amount: number | null;
}

/**
 * The letter's annexure cell, except that a failed ULB form shows its own status ("Not Started", "In Progress",
 * "Returned by State"...) instead of "No", so the reason is visible. The 14th FC unspent amount comes back as
 * Rupees, with only its exemption note as text.
 */
export function buildLiveConditionCell(
  criterion: ClaimLetterCriterionDetail,
  ulbId: string,
  unspentRupees: number,
): LiveConditionCell {
  if (criterion.type === FC_UNSPENT_CRITERION_TYPE) {
    return {
      text: discretionaryExemptionText(criterion.discretionaryExemptions.get(ulbId)) ?? '',
      amount: unspentRupees,
    };
  }
  const evidence = criterion.formEvidence.get(ulbId);
  if (evidence?.bucket === 'INELIGIBLE') {
    const status = evidence.statusAtEvaluation ?? FORM_STATUS.NOT_STARTED;
    return { text: LIVE_STATUS_LABELS[status] ?? getFormStatusLabel(status), amount: null };
  }
  return { text: buildAnnexureCell(criterion, ulbId, unspentRupees), amount: null };
}

/** True when no ULB has a ULB-owned form past Not Started. False when the State has no ULBs or no ULB-owned forms. */
export function noUlbHasStarted(criteria: readonly ClaimLetterCriterionDetail[], ulbIds: readonly string[]): boolean {
  const ulbOwned = criteria.filter((c) => c.formEvidence.size > 0);
  if (!ulbIds.length || !ulbOwned.length) return false;
  return ulbOwned.every((c) => [...c.formEvidence.values()].every((e) => !hasStarted(e.statusAtEvaluation)));
}

/** A cached row with the letter holding it, read live. */
export interface MohuaUlbEligibilityJoinedRow {
  row: MohuaUlbEligibilityBuildRow;
  batch: MohuaUlbEligibilityBatch | null;
}

/** NONE matches a ULB in no letter; a number matches that batch. */
const matchesBatch = (batch: MohuaUlbEligibilityBatch | null, filter: string): boolean =>
  filter === MOHUA_ULB_ELIGIBILITY_NOT_IN_LETTER ? batch === null : batch?.batchNumber === Number(filter);

/** Search (already regex-escaped) and the four filters. Search covers the name and the code the page shows: the
 *  census code, or the SB code when there is none. */
export function matchesUlbEligibilityQuery(
  { row, batch }: MohuaUlbEligibilityJoinedRow,
  query: GetMohuaUlbEligibilityQueryDto,
  pattern: RegExp | null,
): boolean {
  if (pattern && ![row.name, row.censusCode ?? row.sbCode].some((v) => v && pattern.test(v))) return false;
  if (query.eligibility && (query.eligibility === 'ELIGIBLE') !== row.eligible) return false;
  if (query.batch && !matchesBatch(batch, query.batch)) return false;
  if (query.letterStatus !== undefined && batch?.status !== query.letterStatus) return false;
  if (query.condition && !row.failedConditions.includes(query.condition)) return false;
  return true;
}

/** Counts per key, sorted by key. */
export function countBy<K extends number>(keys: readonly K[]): { key: K; count: number }[] {
  const counts = new Map<K, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a - b).map(([key, count]) => ({ key, count }));
}
