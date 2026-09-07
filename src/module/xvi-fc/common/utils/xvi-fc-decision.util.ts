import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import type { UserDocument } from 'src/schemas/user/user.schema';

export interface DecisionRecord {
  status: 'APPROVED' | 'RETURNED';
  note: string | null;
  decidedBy: {
    userId: Types.ObjectId;
    role: string;
    name: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  };
  decidedAt: Date;
}

/**
 * Builds the `{status, note, decidedBy, decidedAt}` shape recorded for every STATE/MoHUA decision,
 * on any XVI-FC form. `deciderName` is looked up by the caller (a live `User.name` read at
 * decision time, not resolvable from `AuthUser`/the JWT) so it can be denormalized here rather
 * than requiring a populate/lookup every time the decision is later displayed.
 */
export function buildDecisionRecord(
  decision: 'APPROVED' | 'RETURNED',
  note: string | null | undefined,
  user: AuthUser,
  ipAddress: string | null,
  userAgent: string | null,
  deciderName: string | null = null,
): DecisionRecord {
  return {
    status: decision,
    note: note ?? null,
    decidedBy: { userId: new Types.ObjectId(user._id), role: user.role, name: deciderName, ipAddress, userAgent },
    decidedAt: new Date(),
  };
}

/**
 * Resolves the acting user's current display name for `buildDecisionRecord`'s `deciderName` param
 * — one shared lookup so every STATE/MoHUA/manual-review decision call site fetches it the same
 * way, instead of each inlining its own `findById(...).select('name')`.
 */
export async function resolveDeciderName(userModel: Model<UserDocument>, userId: string): Promise<string | null> {
  const user = await userModel.findById(userId).select('name').lean().exec();
  return user?.name ?? null;
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
