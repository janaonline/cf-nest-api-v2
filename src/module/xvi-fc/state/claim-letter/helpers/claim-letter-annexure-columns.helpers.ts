import type { ClaimLetterColumn, ClaimLetterColumnKind } from '../types/claim-letter-document.types';

/** Per-mille column shares (approved v3 sample); Yes/No columns share what is left. */
const COLUMN_SHARE: Record<Exclude<ClaimLetterColumnKind, 'yesNo'>, number> = {
  serial: 35,
  name: 140,
  value: 95,
  amount: 100,
};
const ALLOCATION_SHARE = 95; // Tied and Untied (the last two columns)

/** How each annexure column is aligned, in the claim letter's .docx and the MoHUA OM's PDF alike. */
export const CLAIM_LETTER_COLUMN_ALIGN: Record<ClaimLetterColumnKind, 'left' | 'center' | 'right'> = {
  serial: 'center',
  name: 'left',
  value: 'center',
  yesNo: 'center',
  amount: 'right',
};

/** Fixed shares per column kind; Yes/No columns split the rest equally (or it goes to the name). */
export function claimLetterColumnShares(columns: ClaimLetterColumn[]): number[] {
  const last = columns.length - 1;
  const shares = columns.map((c, i) =>
    c.kind === 'yesNo' ? 0 : i >= last - 1 && c.kind === 'amount' ? ALLOCATION_SHARE : COLUMN_SHARE[c.kind],
  );
  const yesNoCount = columns.filter((c) => c.kind === 'yesNo').length;
  const rest = 1000 - shares.reduce((a, s) => a + s, 0);
  if (yesNoCount === 0) return shares;
  const each = Math.floor(rest / yesNoCount);
  return columns.map((c, i) => (c.kind === 'yesNo' ? each : shares[i]));
}
