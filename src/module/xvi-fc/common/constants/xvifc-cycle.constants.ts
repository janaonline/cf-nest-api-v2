import { parseStartCalendarYear } from '../utils/design-year-label.util';

/**
 * Fixed 16th Finance Commission award period (2026-27 to 2030-31).
 * Scopes the shared Year collection to the 16th FC cycle, independent of Year.isActive.
 * Changes only if the officially defined award period is revised.
 */
export const XVIFC_CYCLE_START_YEAR = 2026;
export const XVIFC_CYCLE_END_YEAR = 2030; // starting calendar year of the last cycle year, "2030-31"

/** True when a design-year label's starting calendar year falls within the 16th FC award period. */
export function isWithinXvifcCycle(yearLabel: string): boolean {
  try {
    const startCalendarYear = parseStartCalendarYear(yearLabel);
    return startCalendarYear >= XVIFC_CYCLE_START_YEAR && startCalendarYear <= XVIFC_CYCLE_END_YEAR;
  } catch {
    // An unrecognized label format can't belong to this cycle - exclude it rather than fail the
    // whole listing over one malformed Year document.
    return false;
  }
}

/**
 * True when a design year's own submission window has actually opened - its starting calendar
 * year is on or before `referenceDate`'s calendar year. E.g. while the current calendar year is
 * 2026, "2026-27" has started but "2027-28" through "2030-31" haven't yet, regardless of any
 * admin-set `yearAccess` flag. `referenceDate` defaults to now; pass it explicitly in tests instead
 * of relying on the wall clock.
 */
export function hasDesignYearStarted(yearLabel: string, referenceDate: Date = new Date()): boolean {
  try {
    return parseStartCalendarYear(yearLabel) <= referenceDate.getFullYear();
  } catch {
    return false;
  }
}
