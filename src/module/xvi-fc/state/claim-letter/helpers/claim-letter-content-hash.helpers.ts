import { createHash } from 'crypto';

// Bump when the amount unit or precision changes; the version is part of the hash.
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

/** SHA-256 over ordered tokens, not JSON.stringify (key order is not stable), children sorted by
 *  ulbId. Identity and amounts only: it detects a change in what was claimed, not in metadata. */
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
