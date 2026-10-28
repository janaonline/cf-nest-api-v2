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
 *  the caller owns the transaction. Shared by both stale-build reclaim paths (ADR 0002). */
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
