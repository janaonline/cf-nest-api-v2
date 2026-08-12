const TEMPLATE_TOKEN_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Substitutes `{{tokenName}}` placeholders in `text` from `tokens` — generic, not per-formType.
 * Used to let DB-authored checklist copy (`ClaimEligibilityConfig.checklistSummary`/
 * `displayDescription`) reference a value computed at request time (e.g. `priorFcCycleLabel`)
 * without baking it into the stored string, so a future FC-cycle boundary change never requires a
 * content edit for text that already uses the token.
 *
 * An unknown placeholder (a typo, or a token this call site didn't provide) is left as-is rather
 * than silently dropped — a wrong `{{token}}` stays visibly wrong instead of disappearing into a
 * blank gap in the sentence.
 */
export function interpolateTemplateTokens(
  text: string | undefined,
  tokens: Record<string, string>,
): string | undefined {
  if (!text) return text;
  return text.replace(TEMPLATE_TOKEN_PATTERN, (match, key: string) => tokens[key] ?? match);
}
