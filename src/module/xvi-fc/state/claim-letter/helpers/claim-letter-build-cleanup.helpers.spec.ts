import { ClientSession, Types } from 'mongoose';
import { deleteBuildingParentArtifacts, ClaimLetterBuildCleanupModels } from './claim-letter-build-cleanup.helpers';

function mockModels() {
  const batchUlbModel = { deleteMany: jest.fn().mockResolvedValue(undefined) };
  const lockModel = { deleteMany: jest.fn().mockResolvedValue(undefined) };
  const batchModel = { deleteOne: jest.fn().mockResolvedValue(undefined) };
  return {
    batchUlbModel,
    lockModel,
    batchModel,
    asModels: () => ({ batchModel, batchUlbModel, lockModel }) as unknown as ClaimLetterBuildCleanupModels,
  };
}

describe('deleteBuildingParentArtifacts', () => {
  it('deletes children, own-buildRequestId locks, and the BUILDING parent, scoped correctly', async () => {
    const { batchUlbModel, lockModel, batchModel, asModels } = mockModels();
    const session = {} as ClientSession;
    const parentId = new Types.ObjectId();

    await deleteBuildingParentArtifacts(asModels(), parentId, 'req-1', session);

    expect(batchUlbModel.deleteMany).toHaveBeenCalledWith({ claimLetter: parentId }, { session });
    expect(lockModel.deleteMany).toHaveBeenCalledWith({ claimLetter: parentId, buildRequestId: 'req-1' }, { session });
    expect(batchModel.deleteOne).toHaveBeenCalledWith({ _id: parentId, assemblyStatus: 'BUILDING' }, { session });
  });

  it('never releases locks by the bare business key alone — always scoped by claimLetter', async () => {
    const { lockModel, asModels } = mockModels();
    const parentId = new Types.ObjectId();

    await deleteBuildingParentArtifacts(asModels(), parentId, 'req-2', {} as ClientSession);

    const [lockFilter] = lockModel.deleteMany.mock.calls[0] as [
      { claimLetter: Types.ObjectId; buildRequestId: string },
    ];
    expect(lockFilter).toHaveProperty('claimLetter', parentId);
    expect(lockFilter).toHaveProperty('buildRequestId', 'req-2');
  });
});
