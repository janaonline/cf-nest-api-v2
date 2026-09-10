/**
 * Design-year ULB-applicability cutoff (brain §6.5) — centralizes the date-boundary rule so no
 * feature hand-rolls its own comparison against `ulbs.dateOfConstitution`. Brain §26.1 explicitly
 * flags the *exact* cutoff rule as "not an invitation to guess" and requiring product sign-off;
 * this function ships with a stated placeholder default (end of the design year's second
 * calendar/fiscal year) so the real rule can be swapped in later as a one-line change, without
 * touching any call site.
 */
export function resolveDesignYearApplicabilityCutoff(designYearLabel: string): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(designYearLabel);
  if (!match) {
    throw new Error(`Unrecognized design-year label format: "${designYearLabel}". Expected "YYYY-YY".`);
  }

  const startYear = Number(match[1]);
  const shortEndYear = Number(match[2]);
  const century = Math.floor(startYear / 100) * 100;
  let endYear = century + shortEndYear;
  if (endYear <= startYear) endYear += 100;

  // Placeholder default: 31 March of the design year's second calendar year (e.g. "2026-27" ->
  // 2027-03-31), matching the fiscal-year convention already used elsewhere in xvi-fc.
  return new Date(Date.UTC(endYear, 2, 31, 23, 59, 59, 999));
}
