import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { formatRupeesInLakh } from 'src/module/xvi-fc/common/utils/xvi-fc-amount-format.util';
import type { ClaimLetterCriterionDetail } from '../services/eligibility/claim-letter-eligibility.service';
import type { ClaimLetterColumn, ClaimLetterParagraph, ClaimLetterRun } from '../types/claim-letter-document.types';

export const FC_UNSPENT_CRITERION_TYPE = 'FC_UNSPENT_STATE';
const EXEMPTION_REQUESTED = 'Exemption requested';
const IST_OFFSET_MS = 330 * 60 * 1000;
const NBSP = ' ';

// ─── Runs and paragraphs ───────────────────────────────────────────────────

export const t = (text: string): ClaimLetterRun => ({ text });
export const b = (text: string): ClaimLetterRun => ({ text, bold: true });
export const ph = (text: string, bold = false): ClaimLetterRun => ({ text, placeholder: true, ...(bold && { bold }) });
export const para = (runs: ClaimLetterRun[], number?: string): ClaimLetterParagraph =>
  number ? { runs, number } : { runs };

// ─── Numbers, fractions, years ────────────────────────────────────────────

/** 1 decimal, half-up, trailing ".0" dropped: (2, 10) -> "20", (1, 6) -> "16.7". */
export function formatPercent(part: number, total: number): string {
  if (total === 0) return '0';
  const tenths = Math.floor((part * 2000 + total) / (2 * total));
  const rest = tenths % 10;
  return rest ? `${Math.floor(tenths / 10)}.${rest}` : `${tenths / 10}`;
}

export function formatFraction(part: number, total: number): string {
  return `${part}/${total} (${formatPercent(part, total)}%)`;
}

export function formatFractionOrNil(part: number, total: number): string {
  return part === 0 ? 'Nil' : formatFraction(part, total);
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "2026-27" shifted by -1 -> "2025-26". */
export function shiftFinancialYear(fyLabel: string, offset: number): string {
  const start = Number(fyLabel.slice(0, 4)) + offset;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

/** GTC rule: installment 1 of FY Y certifies the 2nd installment of FY Y-1. */
export function previousInstallmentLabel(installment: 1 | 2, fyLabel: string): string {
  return installment === 1
    ? `2nd installment of FY ${shiftFinancialYear(fyLabel, -1)}`
    : `1st installment of FY ${fyLabel}`;
}

// ─── Dates ─────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "07 Oct 2026" from the date's UTC parts (fixed month names, so no locale dependence). */
function dayMonthYear(date: Date): string {
  return `${pad2(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** ISO date string -> "07 Oct 2026", read in UTC (date pickers store the picked day at UTC midnight). */
export function formatIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dayMonthYear(date);
}

/** "07 Oct 2026, 14:30" in IST. */
export function formatIstDateTime(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return `${dayMonthYear(ist)}, ${pad2(ist.getUTCHours())}:${pad2(ist.getUTCMinutes())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// ─── Letter-detail slots ───────────────────────────────────────────────────

/** A saved letter-detail value formatted for print (date "07 Oct 2026", radio / select option label);
 *  null when blank. */
export function formatDetailValue(value: unknown, question: FieldConfig | undefined): string | null {
  if (question?.formFieldType === 'date') return formatIsoDate(value);
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  const text = String(value).trim();
  if (!text) return null;
  const options = question?.options as (string | { id: string; label: string })[] | undefined;
  const option = options?.find((o) => (typeof o === 'string' ? o === text : o.id === text));
  return option && typeof option !== 'string' ? option.label : text;
}

/** A letter-detail slot: the value as plain text, or its highlighted placeholder when blank (an
 *  empty placeholder prints nothing). */
export function slotRun(
  field: string,
  value: string | null,
  placeholder: string,
  opts: { bold?: boolean; lead?: string } = {},
): ClaimLetterRun {
  const run: ClaimLetterRun =
    value !== null ? { text: value } : placeholder ? { text: placeholder, placeholder: true } : { text: '' };
  return { ...run, field, ...(opts.bold && { bold: true }), ...(opts.lead && { lead: opts.lead }) };
}

/** What a run prints: `lead` only before a filled slot value. */
export function printedText(run: ClaimLetterRun): string {
  return run.lead && run.text && !run.placeholder ? run.lead + run.text : run.text;
}

// ─── Annexure ──────────────────────────────────────────────────────────────

export function criterionColumn(criterion: ClaimLetterCriterionDetail): ClaimLetterColumn {
  if (criterion.type === FC_UNSPENT_CRITERION_TYPE) {
    return { header: `${criterion.letterColumnLabel} (₹${NBSP}lakh)`, kind: 'amount' };
  }
  return {
    header: criterion.letterColumnLabel,
    kind: criterion.evaluationLevel === 'FORM_AND_ROW' ? 'value' : 'yesNo',
  };
}

export const TIED_COLUMN: ClaimLetterColumn = { header: `Tied grant Allocation (₹${NBSP}lakh)`, kind: 'amount' };
export const UNTIED_COLUMN: ClaimLetterColumn = { header: `Untied grant allocation (₹${NBSP}lakh)`, kind: 'amount' };

/**
 * One annexure cell, first match wins:
 * 1. MoHUA-approved exemption: "Exemption requested" (14th FC: amount + " (Exemption requested)").
 * 2. 14th FC: unspent amount in lakh if above 0, else "Nil".
 * 3. Row-level criterion with a row: the value as entered, + " (pending review)" if not accepted.
 * 4. Row-level criterion without a row: "Yes" when exempt, else "Not submitted".
 * 5. Others: ELIGIBLE / EXEMPTED "Yes", INELIGIBLE "No".
 */
export function buildAnnexureCell(criterion: ClaimLetterCriterionDetail, ulbId: string, unspentRupees: number): string {
  const approved = criterion.approvedExemptionUlbIds.has(ulbId);
  if (criterion.type === FC_UNSPENT_CRITERION_TYPE) {
    const amount = unspentRupees > 0 ? formatRupeesInLakh(unspentRupees) : 'Nil';
    return approved ? `${amount} (${EXEMPTION_REQUESTED})` : amount;
  }
  if (approved) return EXEMPTION_REQUESTED;

  const bucket = criterion.buckets.get(ulbId);
  if (criterion.evaluationLevel === 'FORM_AND_ROW') {
    const evidence = criterion.rowEvidence.get(ulbId);
    if (evidence?.rowDocumentId && evidence.rowValue !== null) {
      const value = String(evidence.rowValue);
      return evidence.rowAccepted === false ? `${value} (pending review)` : value;
    }
    return bucket === 'EXEMPTED' ? 'Yes' : 'Not submitted';
  }
  return bucket === 'ELIGIBLE' || bucket === 'EXEMPTED' ? 'Yes' : 'No';
}
