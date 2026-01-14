export const YEARS: Record<string, string> = {
  '2015-16': '',
  '2016-17': '',
  '2017-18': '63735a4bd44534713673bfbf',
  '2018-19': '63735a5bd44534713673c1ca',
  '2019-20': '607697074dff55e6c0be33ba',
  '2020-21': '606aadac4dff55e6c075c507',
  '2021-22': '606aaf854dff55e6c075d219',
  '2022-23': '606aafb14dff55e6c075d3ae',
  '2023-24': '606aafc14dff55e6c075d3ec',
  '2024-25': '606aafcf4dff55e6c075d424',
  '2025-26': '606aafda4dff55e6c075d48f',
  '2026-27': '67d7d136d3d038946a5239e9',
};

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
