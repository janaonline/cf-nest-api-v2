import { ConflictException } from '@nestjs/common';

/** WriteConflict: another open transaction wrote the same document first. */
const MONGO_WRITE_CONFLICT_CODE = 112;

/** Shown when a State submit and an SO decision on the same State's letters clash (ADR 0009). */
export const CLAIM_LETTER_BUSY_MESSAGE =
  "Another action on this State's claim letters is in progress. Please try again.";

/**
 * A transaction that lost to another one on the same State (submit, SO approve or return all write the per-State
 * guard) becomes a 409 the user can retry, never a 500. Any other error comes back unchanged.
 */
export function toClaimLetterBusyConflict(err: unknown): unknown {
  if (typeof err !== 'object' || err === null) return err;
  const e = err as { code?: unknown; errorLabels?: unknown; hasErrorLabel?: (label: string) => boolean };
  const transient =
    e.code === MONGO_WRITE_CONFLICT_CODE ||
    (typeof e.hasErrorLabel === 'function' && e.hasErrorLabel('TransientTransactionError')) ||
    (Array.isArray(e.errorLabels) && e.errorLabels.includes('TransientTransactionError'));
  return transient ? new ConflictException(CLAIM_LETTER_BUSY_MESSAGE) : err;
}
