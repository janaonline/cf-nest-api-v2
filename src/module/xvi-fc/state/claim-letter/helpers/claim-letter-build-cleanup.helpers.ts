import { ClientSession, Model, Types } from 'mongoose';
import { ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlbDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { ClaimLetterUlbLockDocument } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';

export interface ClaimLetterBuildCleanupModels {
  batchModel: Model<ClaimLetterBatchDocument>;
  batchUlbModel: Model<ClaimLetterBatchUlbDocument>;
  lockModel: Model<ClaimLetterUlbLockDocument>;
}

/** Deletes a BUILDING parent with its children and own-buildRequestId locks (never by business key);
 *  the caller owns the transaction. Shared by both stale-build reclaim paths and a failed build's own
 *  rollback (ADR 0002). The parent goes first: if it is no longer BUILDING (a build that finished in
 *  the meantime), its children and locks are left alone. Returns whether the parent was deleted. */
export async function deleteBuildingParentArtifacts(
  models: ClaimLetterBuildCleanupModels,
  parentId: Types.ObjectId,
  buildRequestId: string,
  session: ClientSession,
): Promise<boolean> {
  const { deletedCount } = await models.batchModel.deleteOne(
    { _id: parentId, assemblyStatus: 'BUILDING' },
    { session },
  );
  if (deletedCount === 0) return false;
  await models.batchUlbModel.deleteMany({ claimLetter: parentId }, { session });
  await models.lockModel.deleteMany({ claimLetter: parentId, buildRequestId }, { session });
  return true;
}
