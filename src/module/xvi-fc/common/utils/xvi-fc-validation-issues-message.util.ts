/**
 * Builds the single, plain-English "what to fix" sentence shown under the validation badges,
 * shared by any xvi-fc state module that reconciles an Excel upload against the active ULB
 * registry — used by both elected-urban-local-bodies and devolution-formula's
 * `buildElectedBodyFileSupportingContent`/`buildExcelFileSupportingContent`, alongside
 * `buildUlbReconciliationBadges` (same sharing rationale: call with your own persisted counts
 * rather than duplicating the clause literals). One short clause per active problem, joined into
 * a single sentence — every combination of problems is covered by construction rather than
 * hand-writing each one. Returns `undefined` (render nothing) when `visible` is false or no
 * clause actually applies.
 */
export function buildValidationIssuesMessage(params: {
  errorRowCount: number;
  missingCount: number;
  newCount: number;
  duplicateCount: number;
  /** Pre-formatted amount, e.g. '₹50,000'. Omit for forms with no allocation dimension (EULB) —
   *  kept as a caller-supplied label rather than a raw number so this util stays free of any
   *  money-formatting logic and reusable by modules with a different currency/format need. */
  allocationMismatchLabel?: string;
  visible: boolean;
}): string | undefined {
  if (!params.visible) return undefined;

  const clauses: string[] = [];
  if (params.errorRowCount > 0) clauses.push(`fix ${params.errorRowCount} row error(s)`);
  if (params.missingCount > 0) clauses.push(`add the ${params.missingCount} missing ULB(s)`);
  if (params.newCount > 0) clauses.push(`register ${params.newCount} new ULB(s)`);
  if (params.duplicateCount > 0) clauses.push(`remove ${params.duplicateCount} duplicate ULB(s)`);
  if (params.allocationMismatchLabel) {
    clauses.push(`reconcile the ${params.allocationMismatchLabel} allocation mismatch`);
  }

  if (clauses.length === 0) return undefined;
  return `To submit, ${joinWithAnd(clauses)}.`;
}

/** Oxford-comma join: `[a]` -> `a`; `[a, b]` -> `a and b`; `[a, b, c]` -> `a, b, and c`. */
function joinWithAnd(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
