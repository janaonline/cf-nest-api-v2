import { createHash } from 'crypto';

// Bump whenever the amount representation (unit or precision) of allocatedAmount/claimedAmount
// changes — a hash computed under an earlier version isn't comparable to this one, even for the
// "same" logical amount, since the version number is folded into the hash (see hashToken below).
export const CLAIM_LETTER_CONTENT_HASH_VERSION = 5;

export interface ClaimLetterContentHashChildInput {
  ulbId: string;
  allocatedAmount: number;
  claimedAmount: number;
}

export interface ClaimLetterContentHashInput {
  state: string;
  year: string;
  installment: 1 | 2;
  batchNumber: 1 | 2 | 3;
  version: number;
  children: ClaimLetterContentHashChildInput[];
}

/** Coerces null/undefined to the literal "null" so a field that's null and one that's omitted never hash differently. */
function hashToken(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'null';
  return String(value);
}

/**
 * Deterministic content hash — SHA-256 over an explicit ordered token array, never generic
 * JSON.stringify (key ordering / numeric formatting isn't guaranteed stable across Node versions
 * or object construction order). Children are sorted ascending by ulbId before hashing so
 * build/request insertion order never changes the result. Only identity + financial content is
 * included — audit timestamps and file checksums are deliberately excluded, since this hash exists
 * to detect a change in what was claimed, not a change in surrounding metadata.
 */
export function computeClaimLetterContentHash(input: ClaimLetterContentHashInput): string {
  const sortedChildren = [...input.children].sort((a, b) => a.ulbId.localeCompare(b.ulbId));

  const tokens: string[] = [
    hashToken(CLAIM_LETTER_CONTENT_HASH_VERSION),
    hashToken(input.state),
    hashToken(input.year),
    hashToken(input.installment),
    hashToken(input.batchNumber),
    hashToken(input.version),
    hashToken(sortedChildren.length),
  ];

  for (const child of sortedChildren) {
    tokens.push(hashToken(child.ulbId), hashToken(child.allocatedAmount), hashToken(child.claimedAmount));
  }

  return createHash('sha256').update(tokens.join('|')).digest('hex');
}
