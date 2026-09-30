// Escapes regex metacharacters in user-supplied search strings before they're
// interpolated into `new RegExp(...)` — an unescaped input like '(a+)+$' would
// otherwise trigger catastrophic backtracking or a SyntaxError on '('.
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
