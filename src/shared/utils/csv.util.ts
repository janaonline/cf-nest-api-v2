type CsvCell = string | number | null | undefined;

function escapeCsvField(value: CsvCell): string {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Builds an RFC4180-ish CSV string (CRLF line endings, quote-escaped fields). */
export function buildCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
}
