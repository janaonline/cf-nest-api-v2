/** The letter cap's wording and rules (formjson 26 `meta.maxClaimLetters`, ADR 0009). */

import { FORM_STATUS } from 'src/common/constants/form-status.constants';

/** Create refused, and the New Claim reason, while every place is taken. */
export function allLettersInUseMessage(maxClaimLetters: number): string {
  return (
    `All ${maxClaimLetters} claim letters for this installment are in use. ` +
    'A letter that is discarded or returned frees its place.'
  );
}

/** Open letters (not discarded, not returned) fill every place, so no new letter can take a ULB left out. */
export function isEveryPlaceTaken(openLetterCount: number, maxClaimLetters: number): boolean {
  return openLetterCount >= maxClaimLetters;
}

/** The letters that hold a place under the cap: every one not discarded or returned (both set `isAbandoned`). */
export function openLettersFilter<Id>(scope: { state: Id; year: Id; installment: number }): {
  state: Id;
  year: Id;
  installment: number;
  isAbandoned: false;
} {
  return { state: scope.state, year: scope.year, installment: scope.installment, isAbandoned: false };
}

/** The lowest place no open letter holds, up to the cap; null when every place is taken. Counts the places held, not
 *  only their numbers: after the cap is lowered, letters above it still use it up (ADR 0009). */
export function firstFreeBatchNumber(used: ReadonlySet<number>, maxClaimLetters: number): number | null {
  if (used.size >= maxClaimLetters) return null;
  for (let n = 1; n <= maxClaimLetters; n++) if (!used.has(n)) return n;
  return null;
}

/** An open letter as the last-draft rule reads it. */
export type OpenLetterStatus = { _id: unknown; currentFormStatus: number };

/** Open letters, and the drafts among them other than `claimLetterId`. */
export function countOpenLetters(
  openLetters: readonly OpenLetterStatus[],
  claimLetterId: string,
): { openLetterCount: number; otherDraftCount: number } {
  const otherDraftCount = openLetters.filter(
    (l) => l.currentFormStatus === FORM_STATUS.IN_PROGRESS && String(l._id) !== claimLetterId,
  ).length;
  return { openLetterCount: openLetters.length, otherDraftCount };
}

/**
 * Every place is taken and no other draft is open, so this is the last letter that could take a ULB in no letter
 * (ADR 0009). While another draft is open, it can still take them.
 */
export function isLastDraft(openLetterCount: number, otherDraftCount: number, maxClaimLetters: number): boolean {
  return isEveryPlaceTaken(openLetterCount, maxClaimLetters) && otherDraftCount === 0;
}

/** Submit of the last draft refused while some expected ULB is in no letter. */
export function ulbsLeftOutMessage(maxClaimLetters: number, names: readonly string[]): string {
  const shown = names.slice(0, 10);
  const suffix = names.length > shown.length ? ` and ${names.length - shown.length} more` : '';
  return (
    `All ${maxClaimLetters} claim letters for this installment are in use and this is the last draft, so every ULB ` +
    `must be in a claim letter before it can be submitted. Not in any letter yet: ${shown.join(', ')}${suffix}.`
  );
}
