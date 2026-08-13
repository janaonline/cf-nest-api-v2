import { ClientSession, Model, Types } from 'mongoose';
import { ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlbDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { ClaimLetterUlbLockDocument } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';

export interface ClaimLetterBuildCleanupModels {
  batchModel: Model<ClaimLetterBatchDocument>;
  batchUlbModel: Model<ClaimLetterBatchUlbDocument>;
  lockModel: Model<ClaimLetterUlbLockDocument>;
}

/**
 * Deletes a BUILDING parent's children, its own-buildRequestId locks, and the parent itself.
 * Caller owns the session/transaction boundary (start/commit/abort/end) — this only issues the 3
 * deletes against the given session. Scoped by claimLetter + buildRequestId, never the bare
 * business key, per ClaimLetterUlbLockSchema's own release-path invariant. Shared by
 * ClaimLetterRecoveryService's scheduled sweep and ClaimLetterAssemblyService's inline
 * reclaim-on-conflict path so neither service needs to depend on the other.
 */
export async function deleteBuildingParentArtifacts(
  models: ClaimLetterBuildCleanupModels,
  parentId: Types.ObjectId,
  buildRequestId: string,
  session: ClientSession,
): Promise<void> {
  await models.batchUlbModel.deleteMany({ claimLetter: parentId }, { session });
  await models.lockModel.deleteMany({ claimLetter: parentId, buildRequestId }, { session });
  await models.batchModel.deleteOne({ _id: parentId, assemblyStatus: 'BUILDING' }, { session });
}
