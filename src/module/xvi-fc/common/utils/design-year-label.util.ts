/** Parses "2026-27" -> 2026. Throws on an unrecognized format. */
export function parseStartCalendarYear(yearLabel: string): number {
  const match = /^(\d{4})-\d{2}$/.exec(yearLabel);
  if (!match) throw new Error(`Unrecognized design-year label format: "${yearLabel}". Expected "YYYY-YY".`);
  return Number(match[1]);
}

/** Formats a starting calendar year into the "YYYY-YY" label convention. */
export function formatYearLabel(startCalendarYear: number): string {
  const endSuffix = String((startCalendarYear + 1) % 100).padStart(2, '0');
  return `${startCalendarYear}-${endSuffix}`;
}
