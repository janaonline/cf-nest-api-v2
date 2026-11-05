/** Error `code` on a save that refused some selected ULBs; `errors` names each refused request row. */
export const CLAIM_LETTER_ULBS_REJECTED = 'CLAIM_LETTER_ULBS_REJECTED';

export type ClaimLetterRejectedUlbCode = 'INELIGIBLE' | 'IN_ANOTHER_CLAIM' | 'INVALID_CLAIMED_AMOUNT';

export interface ClaimLetterRejectedUlb {
  /** Index in the request's `ulbSelections`. */
  index: number;
  field: 'ulbId' | 'claimedAmount';
  code: ClaimLetterRejectedUlbCode;
  message: string;
}

export interface ClaimLetterRejectedUlbsBody {
  message: string;
  code: typeof CLAIM_LETTER_ULBS_REJECTED;
  errors: Record<string, { field: string; code: ClaimLetterRejectedUlbCode; message: string }[]>;
}

/** Codes named in a refusal message; `errors` still lists every refused row. */
const MAX_NAMED_ULBS = 5;

/** "2 selected ULBs are ineligible or have an invalid claimed amount: a, b." Past five codes, it names
 *  the first five ("..., including a, b, c, d and e."), so a large refusal stays readable. */
export function ineligibleUlbsMessage(identifiers: readonly string[]): string {
  const n = identifiers.length;
  const subject =
    n === 1
      ? '1 selected ULB is ineligible or has an invalid claimed amount'
      : `${n} selected ULBs are ineligible or have an invalid claimed amount`;
  if (n <= MAX_NAMED_ULBS) return `${subject}: ${identifiers.join(', ')}.`;
  const named = identifiers.slice(0, MAX_NAMED_ULBS);
  return `${subject}, including ${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}.`;
}

export function lockedUlbsMessage(n: number): string {
  return `${n} selected ${n === 1 ? 'ULB is' : 'ULBs are'} already locked in another active claim.`;
}

/** Exception body: the banner message, plus one `ulbSelections.<index>.<field>` entry per refused row. */
export function buildRejectedUlbsBody(
  message: string,
  rejected: readonly ClaimLetterRejectedUlb[],
): ClaimLetterRejectedUlbsBody {
  const errors: ClaimLetterRejectedUlbsBody['errors'] = {};
  for (const r of rejected) {
    (errors[`ulbSelections.${r.index}.${r.field}`] ??= []).push({ field: r.field, code: r.code, message: r.message });
  }
  return { message, code: CLAIM_LETTER_ULBS_REJECTED, errors };
}
