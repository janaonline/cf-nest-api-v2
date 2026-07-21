import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

export interface DecisionRecord {
  status: 'APPROVED' | 'RETURNED';
  note: string | null;
  decidedBy: { userId: Types.ObjectId; role: string; ipAddress: string | null; userAgent: string | null };
  decidedAt: Date;
}

/** Builds the `{status, note, decidedBy, decidedAt}` shape recorded for every STATE/MoHUA decision, on any XVI-FC form. */
export function buildDecisionRecord(
  decision: 'APPROVED' | 'RETURNED',
  note: string | null | undefined,
  user: AuthUser,
  ipAddress: string | null,
  userAgent: string | null,
): DecisionRecord {
  return {
    status: decision,
    note: note ?? null,
    decidedBy: { userId: new Types.ObjectId(user._id), role: user.role, ipAddress, userAgent },
    decidedAt: new Date(),
  };
}

export interface BulkDecisionResult {
  batchId: string;
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{ id: string; success: boolean; error?: string }>;
}

/**
 * Gmail-style bulk approve/return executor, shared across every XVI-FC form: generates one
 * batchId, runs `decideOne` per id sequentially so each row succeeds or fails independently,
 * and tallies the outcome. `decideOne` is the form's own single-record decide method.
 */
export async function runBulkDecision(
  ids: readonly string[],
  decideOne: (id: string, batchId: string) => Promise<unknown>,
): Promise<BulkDecisionResult> {
  const batchId = uuidv4();
  const results: Array<{ id: string; success: boolean; error?: string }> = [];

  for (const id of ids) {
    try {
      await decideOne(id, batchId);
      results.push({ id, success: true });
    } catch (err) {
      results.push({ id, success: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  return { batchId, total: ids.length, succeeded, failed: ids.length - succeeded, results };
}
