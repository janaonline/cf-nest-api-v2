/**
 * Single source of truth for each discretionary-exemption reason formId's display label — used for
 * the "Exemption Status" list's per-row labels and audit-log messages (`RequestExemptionService`),
 * and mirrored as static text in the `formjsons` document's `reasonForExemption.options` (formId 34,
 * type `REQUEST_EXEMPTION`, loaded via `RequestExemptionFormJsonConfigService`) — the field set
 * itself lives in that document now, not as a hardcoded constant; see this form's own plan/ADR notes
 * for why the two aren't wired to auto-sync (matches every other xvi-fc form's convention of static
 * formJson-embedded options).
 */
export const REQUEST_EXEMPTION_REASON_LABELS: Record<number, string> = {
  23: 'Election / duly constituted ULB exemption',
  30: 'Audited Financial Statement',
  31: 'Provisional Financial Statement',
};
