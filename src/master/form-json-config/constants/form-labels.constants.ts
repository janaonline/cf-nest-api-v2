/**
 * formId -> short human-readable display label, for read-only UI that lists exemptable forms
 * (e.g. the ULB review dialog's exemption checklist in cityfinance-ng-ui-v2). Mirrors the formId
 * registry in ../CLAUDE.md — add an entry here whenever a new formId is wired into Dynamic Year
 * Access (see that file's "How to add a new form" section).
 */
export const FORM_LABELS: Readonly<Record<number, string>> = {
  32: 'SLB',
};

/** Falls back to a generic "Form #<id>" label for a formId not yet in the registry above. */
export function getFormLabel(formId: number): string {
  return FORM_LABELS[formId] ?? `Form #${formId}`;
}
