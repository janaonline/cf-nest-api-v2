/** Escapes regex metacharacters so user input can be safely used inside a `new RegExp(...)`. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
