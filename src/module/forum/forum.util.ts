/** URL-safe slug (max 80 chars); falls back to "discussion" when nothing usable remains. */
export function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'discussion'
  );
}

/** Bounded, header-injection-safe copy of a request header. */
export function boundedHeader(value: string | string[] | undefined, maxLength: number): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.replace(/[\r\n]/g, '').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}
