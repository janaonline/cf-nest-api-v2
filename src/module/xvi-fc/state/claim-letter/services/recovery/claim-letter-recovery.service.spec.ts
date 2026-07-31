import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ClaimLetterRecoveryService } from './claim-letter-recovery.service';
import { S3Service } from 'src/core/s3/s3.service';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { ClaimLetterUlbLock } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';

/** Chainable Mongoose Query-like mock resolving to `value` once `.exec()` is called. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'lean']) chain[m] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

interface ClaimFixture {
  _id: Types.ObjectId;
  assemblyStatus: 'BUILDING' | 'READY';
  currentFormStatus: number;
  isAbandoned: boolean;
  createdAt: Date;
  financialSummary: { selectedAllocation: number; currentSelectedClaim: number };
  supersedes: Types.ObjectId | null;
  supersededBy: Types.ObjectId | null;
  signedClaimFile: { path: string } | null;
}

interface LockFixture {
  _id: Types.ObjectId;
  claimLetter: Types.ObjectId;
  ulbId: Types.ObjectId;
  lockState: 'ACTIVE' | 'ACKNOWLEDGED';
}

function applyBatchFilter(claims: ClaimFixture[], filter: Record<string, unknown>): ClaimFixture[] {
  if (filter['assemblyStatus'] === 'BUILDING') {
    const createdAt = filter['createdAt'] as { $lt: Date };
    return claims.filter((c) => c.assemblyStatus === 'BUILDING' && c.createdAt < createdAt.$lt);
  }
  const idIn = (filter['_id'] as { $in: Types.ObjectId[] } | undefined)?.$in;
  if (idIn) {
    const idSet = new Set(idIn.map((id) => id.toString()));
    return claims.filter((c) => idSet.has(c._id.toString()));
  }
  if (filter['currentFormStatus'] === FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA) {
    return claims.filter((c) => c.currentFormStatus === FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA && !c.isAbandoned);
  }
  if (filter['assemblyStatus'] === 'READY') {
    return claims.filter((c) => c.assemblyStatus === 'READY');
  }
  if (filter['$or']) {
    return claims.filter((c) => c.supersedes !== null || c.supersededBy !== null);
  }
  if (filter['signedClaimFile']) {
    return claims.filter((c) => c.signedClaimFile !== null);
  }
  return [];
}

function applyLockFilter(locks: LockFixture[], filter: Record<string, unknown>): LockFixture[] {
  const claimLetterIn = (filter['claimLetter'] as { $in: Types.ObjectId[] } | undefined)?.$in;
  if (claimLetterIn) {
    const idSet = new Set(claimLetterIn.map((id) => id.toString()));
    return locks.filter((l) => idSet.has(l.claimLetter.toString()) && l.lockState === filter['lockState']);
  }
  if (filter['lockState'] === 'ACTIVE' || filter['lockState'] === 'ACKNOWLEDGED') {
    return locks.filter((l) => l.lockState === filter['lockState']);
  }
  return [];
}

describe('ClaimLetterRecoveryService', () => {
  let service: ClaimLetterRecoveryService;
  let session: {
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    abortTransaction: jest.Mock;
    endSession: jest.Mock;
  };
  let connection: { startSession: jest.Mock };
  let batchModel: { find: jest.Mock; deleteOne: jest.Mock };
  let batchUlbModel: { find: jest.Mock; aggregate: jest.Mock; deleteMany: jest.Mock };
  let lockModel: { find: jest.Mock; deleteMany: jest.Mock };
  let s3Service: { headObject: jest.Mock };

  beforeEach(async () => {
    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    batchModel = {
      find: jest.fn().mockReturnValue(q([])),
      deleteOne: jest.fn().mockResolvedValue(undefined),
    };
    batchUlbModel = {
      find: jest.fn().mockReturnValue(q([])),
      aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      deleteMany: jest.fn().mockResolvedValue(undefined),
    };
    lockModel = { find: jest.fn().mockReturnValue(q([])), deleteMany: jest.fn().mockResolvedValue(undefined) };
    s3Service = { headObject: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterRecoveryService,
        { provide: getConnectionToken(), useValue: connection },
        { provide: getModelToken(ClaimLetterBatch.name), useValue: batchModel },
        { provide: getModelToken(ClaimLetterBatchUlb.name), useValue: batchUlbModel },
        { provide: getModelToken(ClaimLetterUlbLock.name), useValue: lockModel },
        { provide: S3Service, useValue: s3Service },
      ],
    }).compile();

    service = module.get<ClaimLetterRecoveryService>(ClaimLetterRecoveryService);
  });

  describe('cleanupStaleBuilds', () => {
    it('returns a zero count and starts no session when there are no stale builds', async () => {
      const result = await service.cleanupStaleBuilds(30);
      expect(result).toEqual({ cleanedCount: 0, claimLetterIds: [] });
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('cleans up exactly the stale BUILDING parents, deleting children/locks/parent for each', async () => {
      const staleId1 = new Types.ObjectId();
      const staleId2 = new Types.ObjectId();
      batchModel.find.mockReturnValue(
        q([
          { _id: staleId1, buildRequestId: 'req-1' },
          { _id: staleId2, buildRequestId: 'req-2' },
        ]),
      );

      const result = await service.cleanupStaleBuilds(30);

      expect(result).toEqual({ cleanedCount: 2, claimLetterIds: [staleId1.toString(), staleId2.toString()] });
      expect(batchUlbModel.deleteMany).toHaveBeenCalledWith({ claimLetter: staleId1 }, expect.anything());
      expect(lockModel.deleteMany).toHaveBeenCalledWith(
        { claimLetter: staleId1, buildRequestId: 'req-1' },
        expect.anything(),
      );
      expect(batchModel.deleteOne).toHaveBeenCalledWith(
        { _id: staleId1, assemblyStatus: 'BUILDING' },
        expect.anything(),
      );
      expect(batchUlbModel.deleteMany).toHaveBeenCalledWith({ claimLetter: staleId2 }, expect.anything());
      expect(session.commitTransaction).toHaveBeenCalledTimes(2);
    });

    it('rolls back and rethrows when a cleanup transaction fails mid-flight', async () => {
      batchModel.find.mockReturnValue(q([{ _id: new Types.ObjectId(), buildRequestId: 'req-1' }]));
      batchUlbModel.deleteMany.mockRejectedValue(new Error('delete failed'));

      await expect(service.cleanupStaleBuilds(30)).rejects.toThrow('delete failed');
      expect(session.abortTransaction).toHaveBeenCalled();
    });
  });

  describe('runScheduledStaleBuildCleanup', () => {
    it('calls cleanupStaleBuilds and never throws, even when a stale build is cleaned', async () => {
      const staleId = new Types.ObjectId();
      batchModel.find.mockReturnValue(q([{ _id: staleId, buildRequestId: 'req-1' }]));

      await expect(service.runScheduledStaleBuildCleanup()).resolves.toBeUndefined();
      expect(batchModel.deleteOne).toHaveBeenCalledWith({ _id: staleId, assemblyStatus: 'BUILDING' }, expect.anything());
    });

    it('swallows errors from cleanupStaleBuilds instead of letting them escape the cron tick', async () => {
      batchModel.find.mockImplementation(() => {
        throw new Error('db unavailable');
      });

      await expect(service.runScheduledStaleBuildCleanup()).resolves.toBeUndefined();
    });
  });

  describe('detectAnomalies', () => {
    it('returns an entirely empty report against an empty database', async () => {
      const report = await service.detectAnomalies(30);
      expect(report).toEqual({
        staleBuildingClaims: [],
        orphanedActiveLocks: [],
        acknowledgedLocksWithoutTerminalClaim: [],
        terminalClaimsWithoutAcknowledgedLock: [],
        financialMismatches: [],
        supersessionLinkMismatches: [],
        missingSignedFiles: [],
        staleEditLocksWithChildCountMismatch: [],
      });
    });

    it('flags a stale edit lock only when the persisted child count does not match ulbCount', async () => {
      const mismatchedId = new Types.ObjectId();
      const healthyId = new Types.ObjectId();
      const acquiredAt = new Date(Date.now() - 60 * 60_000);
      // find() is reused across every detectAnomalies sub-query in this service; this spec's
      // fixture-based tests below drive it via a shared applyBatchFilter dispatcher, but this
      // isolated test only needs the one filter shape cleanupStaleEditLocks/this finder use.
      batchModel.find.mockImplementation((filter: Record<string, unknown>) => {
        if (filter['editLockToken']) {
          return q([
            { _id: mismatchedId, ulbCount: 3, editLockAcquiredAt: acquiredAt },
            { _id: healthyId, ulbCount: 2, editLockAcquiredAt: acquiredAt },
          ]);
        }
        return q([]);
      });
      batchUlbModel.aggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: mismatchedId, count: 1 },
          { _id: healthyId, count: 2 },
        ]),
      });

      const report = await service.detectAnomalies(30);

      expect(report.staleEditLocksWithChildCountMismatch).toEqual([
        {
          claimLetterId: String(mismatchedId),
          editLockAcquiredAt: acquiredAt,
          expectedUlbCount: 3,
          actualChildCount: 1,
        },
      ]);
    });

    it('detects exactly the seeded anomalies and reports zero false positives for the healthy control claims in the same dataset', async () => {
      const now = new Date();
      const staleBuildingId = new Types.ObjectId();
      const freshBuildingId = new Types.ObjectId();
      const readyHealthyId = new Types.ObjectId();
      const readyMismatchId = new Types.ObjectId();
      const terminalWithAckId = new Types.ObjectId();
      const terminalMissingAckId = new Types.ObjectId();
      const predecessorId = new Types.ObjectId();
      const successorId = new Types.ObjectId();
      const oneSidedTargetId = new Types.ObjectId();
      const oneSidedSourceId = new Types.ObjectId();
      const dupPredecessorId = new Types.ObjectId();
      const dupSuccessorAId = new Types.ObjectId();
      const dupSuccessorBId = new Types.ObjectId();
      const healthyFileClaimId = new Types.ObjectId();
      const missingFileClaimId = new Types.ObjectId();

      const ulbHealthy = new Types.ObjectId();
      const ulbMissing = new Types.ObjectId();
      const orphanClaimId = new Types.ObjectId(); // referenced only by a lock, never a real claim

      const claims: ClaimFixture[] = [
        {
          _id: staleBuildingId,
          assemblyStatus: 'BUILDING',
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          isAbandoned: false,
          createdAt: new Date(now.getTime() - 60 * 60_000),
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: null,
          supersededBy: null,
          signedClaimFile: null,
        },
        {
          _id: freshBuildingId,
          assemblyStatus: 'BUILDING',
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: null,
          supersededBy: null,
          signedClaimFile: null,
        },
        {
          _id: readyHealthyId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 1000, currentSelectedClaim: 900 },
          supersedes: null,
          supersededBy: null,
          signedClaimFile: null,
        },
        {
          _id: readyMismatchId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 5000, currentSelectedClaim: 5000 },
          supersedes: null,
          supersededBy: null,
          signedClaimFile: null,
        },
        {
          _id: terminalWithAckId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: null,
          supersededBy: null,
          signedClaimFile: null,
        },
        {
          _id: terminalMissingAckId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: null,
          supersededBy: null,
          signedClaimFile: null,
        },
        {
          _id: predecessorId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: null,
          supersededBy: successorId,
          signedClaimFile: null,
        },
        {
          _id: successorId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: predecessorId,
          supersededBy: null,
          signedClaimFile: null,
        },
        {
          _id: oneSidedSourceId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: null,
          supersededBy: oneSidedTargetId,
          signedClaimFile: null,
        },
        {
          _id: oneSidedTargetId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: null, // does NOT point back to oneSidedSourceId — the anomaly
          supersededBy: null,
          signedClaimFile: null,
        },
        {
          _id: dupPredecessorId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: null,
          supersededBy: dupSuccessorAId,
          signedClaimFile: null,
        },
        {
          _id: dupSuccessorAId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: dupPredecessorId,
          supersededBy: null,
          signedClaimFile: null,
        },
        {
          _id: dupSuccessorBId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: dupPredecessorId,
          supersededBy: null,
          signedClaimFile: null,
        },
        {
          _id: healthyFileClaimId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: null,
          supersededBy: null,
          signedClaimFile: { path: 'claim-letter/healthy.pdf' },
        },
        {
          _id: missingFileClaimId,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          isAbandoned: false,
          createdAt: now,
          financialSummary: { selectedAllocation: 0, currentSelectedClaim: 0 },
          supersedes: null,
          supersededBy: null,
          signedClaimFile: { path: 'claim-letter/missing.pdf' },
        },
      ];

      const locks: LockFixture[] = [
        // Orphaned: claim doesn't exist at all.
        { _id: new Types.ObjectId(), claimLetter: orphanClaimId, ulbId: new Types.ObjectId(), lockState: 'ACTIVE' },
        // Healthy ACTIVE lock on a real, still-open claim.
        {
          _id: new Types.ObjectId(),
          claimLetter: freshBuildingId,
          ulbId: new Types.ObjectId(),
          lockState: 'ACTIVE',
        },
        // ACKNOWLEDGED lock on a claim that is NOT status 7 — anomaly.
        {
          _id: new Types.ObjectId(),
          claimLetter: readyHealthyId,
          ulbId: new Types.ObjectId(),
          lockState: 'ACKNOWLEDGED',
        },
        // Correctly ACKNOWLEDGED lock matching terminalWithAckId's only child.
        { _id: new Types.ObjectId(), claimLetter: terminalWithAckId, ulbId: ulbHealthy, lockState: 'ACKNOWLEDGED' },
        // terminalMissingAckId's child has no matching ACKNOWLEDGED lock at all.
      ];

      const children = [
        { claimLetter: terminalWithAckId, ulbId: ulbHealthy },
        { claimLetter: terminalMissingAckId, ulbId: ulbMissing },
      ];

      batchModel.find.mockImplementation((filter: Record<string, unknown>) => q(applyBatchFilter(claims, filter)));
      lockModel.find.mockImplementation((filter: Record<string, unknown>) => q(applyLockFilter(locks, filter)));
      batchUlbModel.find.mockReturnValue(q(children));
      batchUlbModel.aggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: readyHealthyId, allocated: 1000, claimed: 900 },
          { _id: readyMismatchId, allocated: 4000, claimed: 4000 }, // stored says 5000/5000 — mismatch
        ]),
      });
      s3Service.headObject.mockImplementation((path: string) =>
        path === 'claim-letter/missing.pdf' ? Promise.reject(new Error('NotFound')) : Promise.resolve({}),
      );

      const report = await service.detectAnomalies(30);

      expect(report.staleBuildingClaims).toEqual([
        { claimLetterId: staleBuildingId.toString(), createdAt: claims[0].createdAt },
      ]);

      expect(report.orphanedActiveLocks).toHaveLength(1);
      expect(report.orphanedActiveLocks[0]).toMatchObject({ claimLetterId: orphanClaimId.toString() });

      expect(report.acknowledgedLocksWithoutTerminalClaim).toHaveLength(1);
      expect(report.acknowledgedLocksWithoutTerminalClaim[0]).toMatchObject({
        claimLetterId: readyHealthyId.toString(),
      });

      expect(report.terminalClaimsWithoutAcknowledgedLock).toEqual([
        { claimLetterId: terminalMissingAckId.toString(), missingUlbIds: [ulbMissing.toString()] },
      ]);

      expect(report.financialMismatches).toEqual([
        {
          claimLetterId: readyMismatchId.toString(),
          storedSelectedAllocation: 5000,
          actualSelectedAllocation: 4000,
          storedCurrentSelectedClaim: 5000,
          actualCurrentSelectedClaim: 4000,
        },
      ]);

      const mismatchClaimIds = report.supersessionLinkMismatches.map((m) => m.claimLetterId).sort();
      expect(mismatchClaimIds).toEqual(
        [oneSidedSourceId.toString(), dupSuccessorAId.toString(), dupSuccessorBId.toString()].sort(),
      );
      expect(report.supersessionLinkMismatches).toHaveLength(3);

      expect(report.missingSignedFiles).toEqual([
        { claimLetterId: missingFileClaimId.toString(), path: 'claim-letter/missing.pdf' },
      ]);
    });
  });
});
