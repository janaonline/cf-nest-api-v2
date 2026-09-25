/**
 * Formats a date as "31 March 2030" — the shared display format for DB-configured date
 * boundaries (Excel template prompts, EULB declaration-letter dates) across xvi-fc. Extracted
 * from a formerly-private, duplicated `formatEulbDate()` so every caller stays in sync rather
 * than each feature keeping its own copy. Returns '-' for a null/invalid value.
 */
export function formatXviFcDate(value: Date | string | null): string {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}
