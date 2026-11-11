import { ClientSession, Types } from 'mongoose';
import { deleteBuildingParentArtifacts, ClaimLetterBuildCleanupModels } from './claim-letter-build-cleanup.helpers';

function mockModels(deletedCount = 1) {
  const batchUlbModel = { deleteMany: jest.fn().mockResolvedValue(undefined) };
  const lockModel = { deleteMany: jest.fn().mockResolvedValue(undefined) };
  const batchModel = { deleteOne: jest.fn().mockResolvedValue({ deletedCount }) };
  return {
    batchUlbModel,
    lockModel,
    batchModel,
    asModels: () => ({ batchModel, batchUlbModel, lockModel }) as unknown as ClaimLetterBuildCleanupModels,
  };
}

describe('deleteBuildingParentArtifacts', () => {
  it('deletes the BUILDING parent first, then its children and own-buildRequestId locks', async () => {
    const { batchUlbModel, lockModel, batchModel, asModels } = mockModels();
    const session = {} as ClientSession;
    const parentId = new Types.ObjectId();

    await expect(deleteBuildingParentArtifacts(asModels(), parentId, 'req-1', session)).resolves.toBe(true);

    expect(batchModel.deleteOne).toHaveBeenCalledWith({ _id: parentId, assemblyStatus: 'BUILDING' }, { session });
    expect(batchUlbModel.deleteMany).toHaveBeenCalledWith({ claimLetter: parentId }, { session });
    expect(lockModel.deleteMany).toHaveBeenCalledWith({ claimLetter: parentId, buildRequestId: 'req-1' }, { session });
    const parentOrder = batchModel.deleteOne.mock.invocationCallOrder[0];
    expect(parentOrder).toBeLessThan(batchUlbModel.deleteMany.mock.invocationCallOrder[0]);
    expect(parentOrder).toBeLessThan(lockModel.deleteMany.mock.invocationCallOrder[0]);
  });

  it('leaves children and locks alone when the parent is no longer BUILDING (the build finished)', async () => {
    const { batchUlbModel, lockModel, asModels } = mockModels(0);

    await expect(
      deleteBuildingParentArtifacts(asModels(), new Types.ObjectId(), 'req-3', {} as ClientSession),
    ).resolves.toBe(false);

    expect(batchUlbModel.deleteMany).not.toHaveBeenCalled();
    expect(lockModel.deleteMany).not.toHaveBeenCalled();
  });

  it('never releases locks by the bare business key alone - always scoped by claimLetter', async () => {
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
