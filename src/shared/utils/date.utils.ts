/**
 * @param includeTime - If true (default), returns both date and time in 'YYYY-MM-DD_HH-MM-SS' format.
 *                      If false, returns only the date in 'YYYY-MM-DD' format.
 */
export function getTimeStamp(includeTime: boolean = true): string {
  const now = new Date();
  const dateString = `${now.getFullYear()}-${(now.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  const timeString = `${now.getHours().toString().padStart(2, '0')}-${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}-${now.getSeconds().toString().padStart(2, '0')}`;

  if (includeTime) return `${dateString}_${timeString}`;
  return dateString;
}

/**
 * Converts a given Date to Indian Standard Time (IST) and returns an ISO string.
 *
 * Important:
 * - `toISOString()` always returns a UTC-based string ending with `Z`.
 * - This function shifts the timestamp by +05:30 (IST offset),
 *   then serializes it as an ISO string in UTC format.
 *
 * Example:
 *   Input Date (UTC): 2026-01-01T00:00:00.000Z
 *   Output ISO:       2026-01-01T05:30:00.000Z
 *
 * @param date - A valid JavaScript Date object
 * @returns ISO 8601 string representing the IST-shifted time
 */
export function toIST(date: Date): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return 'NA';
    // throw new Error('Invalid Date provided to toIST()');
  }

  // IST is UTC + 5 hours 30 minutes
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

  // Create a new Date to avoid mutating the input
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);

  return istDate.toISOString();
}
