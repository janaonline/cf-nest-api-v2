import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ClaimLetterAssemblyService } from './claim-letter-assembly.service';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterHistoryService } from '../history/claim-letter-history.service';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { ClaimLetterUlbLock } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import { State } from 'src/schemas/state.schema';
import { Year } from 'src/schemas/year.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

/** Chainable Mongoose Query-like mock resolving to `value` once `.exec()` is called. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'lean', 'session']) chain[m] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

function duplicateKeyError(): Error & { code: number } {
  return Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
}

/** `createDraft`/`updateDraft`/`abandonDraft` now map their raw doc through
 *  `mapClaimLetterBatchDocToSummary`, which reads `financialSummary` unconditionally — every mock
 *  doc that flows through as one of those methods' final return value needs this present. */
const zeroFinancialSummary = {
  totalInstallmentAllocation: 0,
  totalAlreadyAcknowledged: 0,
  totalClaimInProgress: 0,
  totalClaimInDraft: 0,
  availableToClaim: 0,
  selectedAllocation: 0,
  currentSelectedClaim: 0,
  remainingIfAcknowledged: 0,
};

describe('ClaimLetterAssemblyService', () => {
  const stateId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const parentId = new Types.ObjectId();
  const ulbAId = new Types.ObjectId();
  const ulbBId = new Types.ObjectId();
  const rowId = new Types.ObjectId();
  const formDocId = new Types.ObjectId();

  const stateUser: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: 'STATE',
    scope: Scope.STATE,
    accessLevel: null,
    state: stateId.toString(),
  };

  let service: ClaimLetterAssemblyService;
  let session: {
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    abortTransaction: jest.Mock;
    endSession: jest.Mock;
  };
  let connection: { startSession: jest.Mock };
  let batchModel: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findById: jest.Mock;
    deleteOne: jest.Mock;
    updateOne: jest.Mock;
  };
  let batchUlbModel: { bulkWrite: jest.Mock; find: jest.Mock; aggregate: jest.Mock; deleteMany: jest.Mock };
  let lockModel: { insertMany: jest.Mock; find: jest.Mock; deleteMany: jest.Mock; updateMany: jest.Mock };
  let stateModel: { findById: jest.Mock };
  let yearModel: { findById: jest.Mock };
  let ulbModel: { find: jest.Mock };
  let eligibilityService: {
    evaluateStateLevelGate: jest.Mock;
    resolveDevolutionAllocations: jest.Mock;
    resolveUlbLevelEligibility: jest.Mock;
    computeTotalAlreadyAcknowledged: jest.Mock;
    getClaimStatusBreakdown: jest.Mock;
  };
  let historyService: { recordTransition: jest.Mock };

  const allocation = {
    allocatedAmount: 100,
    formDocumentId: formDocId.toString(),
    rowDocumentId: rowId.toString(),
    datasetVersion: 1,
  };

  function persistedChild(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(),
      claimLetter: parentId,
      state: stateId,
      year: yearId,
      installment: 1,
      batchNumber: 1,
      version: 1,
      ulbId: ulbAId,
      ulbSnapshot: { name: 'Alpha ULB', censusCode: '111', sbCode: null },
      allocatedAmount: allocation.allocatedAmount,
      claimedAmount: 100,
      differenceAmount: 0,
      differencePercentageBasisPoints: 0,
      devolutionSource: {
        formDocumentId: formDocId,
        rowDocumentId: rowId,
        datasetVersion: 1,
        allocatedAmount: allocation.allocatedAmount,
        installment: 1,
      },
      eligibilitySources: [],
      ...overrides,
    };
  }

  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      stateId: stateId.toString(),
      yearId: yearId.toString(),
      installment: 1,
      ulbSelections: [{ ulbId: ulbAId.toString(), claimedAmount: 100 }],
      user: stateUser,
      ...overrides,
    };
  }

  function parentDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: parentId,
      state: stateId,
      year: yearId,
      installment: 1,
      batchNumber: 1,
      version: 1,
      currentFormStatus: 2, // IN_PROGRESS
      assemblyStatus: 'READY',
      buildRequestId: 'build-1',
      revision: 0,
      isAbandoned: false,
      financialSummary: zeroFinancialSummary,
      ...overrides,
    };
  }

  beforeEach(async () => {
    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };

    batchModel = {
      findOne: jest.fn().mockReturnValue(q(null)),
      find: jest.fn().mockReturnValue(q([])),
      create: jest.fn().mockResolvedValue([{ _id: parentId, batchNumber: 1, version: 1 }]),
      findOneAndUpdate: jest.fn().mockReturnValue(
        q({
          _id: parentId,
          assemblyStatus: 'READY',
          batchNumber: 1,
          version: 1,
          financialSummary: zeroFinancialSummary,
        }),
      ),
      findById: jest.fn().mockReturnValue(q(null)),
      deleteOne: jest.fn().mockResolvedValue(undefined),
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    batchUlbModel = {
      bulkWrite: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockReturnValue(q([persistedChild()])),
      aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      deleteMany: jest.fn().mockResolvedValue(undefined),
    };
    lockModel = {
      insertMany: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockReturnValue(q([{ ulbId: ulbAId }])),
      deleteMany: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue(undefined),
    };
    stateModel = { findById: jest.fn().mockReturnValue(q({ code: 'KA' })) };
    yearModel = { findById: jest.fn().mockReturnValue(q({ year: '2026-27' })) };
    ulbModel = {
      find: jest.fn().mockReturnValue(q([{ _id: ulbAId, name: 'Alpha ULB', censusCode: '111', sbCode: null }])),
    };
    eligibilityService = {
      evaluateStateLevelGate: jest.fn().mockResolvedValue({ sources: [], passed: true }),
      resolveDevolutionAllocations: jest.fn().mockResolvedValue(new Map([[ulbAId.toString(), allocation]])),
      resolveUlbLevelEligibility: jest.fn().mockResolvedValue({ perUlbEligible: new Map() }),
      computeTotalAlreadyAcknowledged: jest.fn().mockResolvedValue(0),
      getClaimStatusBreakdown: jest.fn().mockResolvedValue({
        totalAlreadyAcknowledged: 0,
        totalClaimInProgress: 0,
        totalClaimInDraft: 0,
        availableToClaim: 100,
      }),
    };
    historyService = { recordTransition: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterAssemblyService,
        { provide: getConnectionToken(), useValue: connection },
        { provide: getModelToken(ClaimLetterBatch.name), useValue: batchModel },
        { provide: getModelToken(ClaimLetterBatchUlb.name), useValue: batchUlbModel },
        { provide: getModelToken(ClaimLetterUlbLock.name), useValue: lockModel },
        { provide: getModelToken(State.name), useValue: stateModel },
        { provide: getModelToken(Year.name), useValue: yearModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: ClaimLetterEligibilityService, useValue: eligibilityService },
        { provide: ClaimLetterHistoryService, useValue: historyService },
      ],
    }).compile();

    service = module.get<ClaimLetterAssemblyService>(ClaimLetterAssemblyService);
  });

  // ─── Access / validation guards (fail before any write) ────────────────────

  it('throws ForbiddenException for a STATE user requesting a different state', async () => {
    const otherStateUser: AuthUser = { ...stateUser, state: new Types.ObjectId().toString() };
    await expect(service.createDraft(baseInput({ user: otherStateUser }))).rejects.toThrow(ForbiddenException);
    expect(connection.startSession).not.toHaveBeenCalled();
  });

  it('throws BadRequestException for installment 2 before any write', async () => {
    await expect(service.createDraft(baseInput({ installment: 2 }))).rejects.toThrow(BadRequestException);
    expect(connection.startSession).not.toHaveBeenCalled();
  });

  it('rejects an empty ULB selection before any write', async () => {
    await expect(service.createDraft(baseInput({ ulbSelections: [] }))).rejects.toThrow(BadRequestException);
    expect(connection.startSession).not.toHaveBeenCalled();
  });

  it('rejects a duplicate ULB within one request before any write', async () => {
    await expect(
      service.createDraft(
        baseInput({
          ulbSelections: [
            { ulbId: ulbAId.toString(), claimedAmount: 100 },
            { ulbId: ulbAId.toString(), claimedAmount: 100 },
          ],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(connection.startSession).not.toHaveBeenCalled();
  });

  // ─── Idempotent retry (docs/adr/0001-idempotent-retry.md) ───────────────────

  it('returns the existing READY doc (mapped to a summary) when retried with the same buildRequestId', async () => {
    const readyDoc = { _id: parentId, assemblyStatus: 'READY', financialSummary: zeroFinancialSummary };
    batchModel.findOne.mockReturnValue(q(readyDoc));

    const result = await service.createDraft(baseInput({ buildRequestId: 'key-1' }));

    expect(result.claimLetterId).toBe(String(parentId));
    expect(connection.startSession).not.toHaveBeenCalled();
    expect(batchModel.findOne).toHaveBeenCalledWith({ buildRequestId: 'key-1', state: stateId });
  });

  it("scopes the idempotent-retry lookup to the requesting state, never returning another state's batch", async () => {
    // A buildRequestId collision belonging to a DIFFERENT state must never resolve — the query
    // itself is state-scoped, so a real (non-mocked) DB would simply find nothing here.
    batchModel.findOne.mockReturnValue(q(null));

    await service.createDraft(baseInput({ buildRequestId: 'key-shared-across-states' }));

    expect(batchModel.findOne).toHaveBeenCalledWith({
      buildRequestId: 'key-shared-across-states',
      state: stateId,
    });
    // Falls through to the normal reservation path since no doc matched this state.
    expect(connection.startSession).toHaveBeenCalled();
  });

  it('throws ConflictException when retried with a buildRequestId whose build is still in progress or failed', async () => {
    batchModel.findOne.mockReturnValue(q({ _id: parentId, assemblyStatus: 'BUILDING' }));

    await expect(service.createDraft(baseInput({ buildRequestId: 'key-1' }))).rejects.toThrow(ConflictException);
  });

  it('does not check for an existing build when no buildRequestId is supplied', async () => {
    await service.createDraft(baseInput());
    expect(batchModel.findOne).not.toHaveBeenCalled();
  });

  // ─── Step 1-2: batch-number allocation + lock acquisition ──────────────────

  it('throws ConflictException when all 3 batch slots are genuinely live (nothing to reclaim)', async () => {
    batchModel.find
      .mockReturnValueOnce(q([{ batchNumber: 1 }, { batchNumber: 2 }, { batchNumber: 3 }])) // allocateBatchNumber
      .mockReturnValue(q([])); // reclaim scan's own slot-occupancy check finds nothing BUILDING
    lockModel.find.mockReturnValue(q([])); // no lock conflict in play for this scenario

    await expect(service.createDraft(baseInput())).rejects.toThrow(ConflictException);
    expect(session.abortTransaction).toHaveBeenCalled();
    expect(session.commitTransaction).not.toHaveBeenCalled();
    // Nothing reclaimable -> no cleanup, no wasted second attempt.
    expect(batchUlbModel.deleteMany).not.toHaveBeenCalled();
    expect(batchModel.create).not.toHaveBeenCalled();
  });

  it('reclaims a stale BUILDING parent occupying a batch slot and succeeds on retry', async () => {
    const staleOwnerId = new Types.ObjectId();
    let reclaimed = false;
    batchModel.find.mockImplementation((filter: Record<string, unknown>) => {
      if (filter['_id']) {
        // reclaimBlockingStaleBuilds's staleCandidates query, keyed by the candidate _id set.
        reclaimed = true;
        return q([{ _id: staleOwnerId, buildRequestId: 'stale-build-req' }]);
      }
      if (filter['assemblyStatus'] === 'BUILDING') {
        // reclaimBlockingStaleBuilds's own slot-occupancy scan.
        return q(reclaimed ? [] : [{ _id: staleOwnerId }]);
      }
      // allocateBatchNumber: 1st attempt sees all 3 slots "used" (one is the stale row); 2nd
      // attempt (after reclaim removed it) sees only 2 genuinely-live slots and picks the 3rd.
      return q(
        reclaimed
          ? [{ batchNumber: 1 }, { batchNumber: 2 }]
          : [{ batchNumber: 1 }, { batchNumber: 2 }, { batchNumber: 3 }],
      );
    });
    lockModel.find.mockImplementation((filter: Record<string, unknown>) =>
      // assertLocksPresent's later verification call (claimLetter-scoped) still needs the real
      // lock; only the reclaim scan's lockOwners query (ulbId-scoped) sees no contention here.
      filter['claimLetter'] ? q([{ ulbId: ulbAId }]) : q([]),
    );

    const result = await service.createDraft(baseInput());

    expect(result.claimLetterId).toBe(String(parentId));
    expect(batchModel.deleteOne).toHaveBeenCalledWith(
      { _id: staleOwnerId, assemblyStatus: 'BUILDING' },
      expect.anything(),
    );
  });

  it('surfaces a clear conflict when a concurrent request already took this batch slot (never retried)', async () => {
    batchModel.create.mockRejectedValue(duplicateKeyError());

    await expect(service.createDraft(baseInput())).rejects.toThrow(/batch slot/i);
    expect(session.abortTransaction).toHaveBeenCalled();
    expect(session.commitTransaction).not.toHaveBeenCalled();
    // Proven always-fresh-contention (never a stale row) -> no reclaim scan is ever entered, and
    // no retry is attempted, for this specific conflict.
    expect(batchModel.create).toHaveBeenCalledTimes(1);
    expect(batchModel.find).toHaveBeenCalledTimes(1);
  });

  it('surfaces a clear conflict — and rolls back the parent — when a selected ULB is locked by a live (non-stale) claim', async () => {
    const liveOwnerId = new Types.ObjectId();
    lockModel.insertMany.mockRejectedValue(duplicateKeyError());
    lockModel.find.mockReturnValue(q([{ ulbId: ulbAId, claimLetter: liveOwnerId }]));

    await expect(service.createDraft(baseInput())).rejects.toThrow(/already locked/i);
    expect(session.abortTransaction).toHaveBeenCalled();
    expect(session.commitTransaction).not.toHaveBeenCalled();
    // A lock owner was found, but batchModel.find's default (empty) means it isn't a stale
    // BUILDING row -> nothing reclaimed, no wasted second attempt.
    expect(batchUlbModel.deleteMany).not.toHaveBeenCalled();
    expect(lockModel.insertMany).toHaveBeenCalledTimes(1);
  });

  it('reclaims a stale lock owner and succeeds on retry', async () => {
    const staleOwnerId = new Types.ObjectId();
    lockModel.insertMany.mockRejectedValueOnce(duplicateKeyError()); // 1st attempt conflicts; retry succeeds
    lockModel.find.mockReturnValue(q([{ ulbId: ulbAId, claimLetter: staleOwnerId }]));
    batchModel.find.mockImplementation((filter: Record<string, unknown>) => {
      if (filter['assemblyStatus'] === 'BUILDING' && filter['createdAt']) {
        return q([{ _id: staleOwnerId, buildRequestId: 'stale-build-req' }]);
      }
      return q([]); // allocateBatchNumber (both attempts) and the slot-occupancy scan
    });

    const result = await service.createDraft(baseInput());

    expect(result.claimLetterId).toBe(String(parentId));
    expect(batchUlbModel.deleteMany).toHaveBeenCalledWith({ claimLetter: staleOwnerId }, expect.anything());
    expect(lockModel.deleteMany).toHaveBeenCalledWith(
      { claimLetter: staleOwnerId, buildRequestId: 'stale-build-req' },
      expect.anything(),
    );
    expect(batchModel.deleteOne).toHaveBeenCalledWith(
      { _id: staleOwnerId, assemblyStatus: 'BUILDING' },
      expect.anything(),
    );
    expect(lockModel.insertMany).toHaveBeenCalledTimes(2);
  });

  it('reclaims a stale lock owner but still fails when another requested ULB is genuinely locked by a live claim', async () => {
    const staleOwnerId = new Types.ObjectId();
    const liveOwnerId = new Types.ObjectId();
    lockModel.insertMany.mockRejectedValue(duplicateKeyError()); // every attempt still conflicts (ulbBId is live)
    lockModel.find.mockReturnValue(
      q([
        { ulbId: ulbAId, claimLetter: staleOwnerId },
        { ulbId: ulbBId, claimLetter: liveOwnerId },
      ]),
    );
    batchModel.find.mockImplementation((filter: Record<string, unknown>) => {
      if (filter['assemblyStatus'] === 'BUILDING' && filter['createdAt']) {
        return q([{ _id: staleOwnerId, buildRequestId: 'stale-build-req' }]);
      }
      return q([]);
    });

    await expect(
      service.createDraft(
        baseInput({
          ulbSelections: [
            { ulbId: ulbAId.toString(), claimedAmount: 100 },
            { ulbId: ulbBId.toString(), claimedAmount: 100 },
          ],
        }),
      ),
    ).rejects.toThrow(/already locked/i);

    // The stale owner's artifacts were cleaned up even though the request overall still failed —
    // reclaim isn't all-or-nothing.
    expect(batchUlbModel.deleteMany).toHaveBeenCalledWith({ claimLetter: staleOwnerId }, expect.anything());
    expect(batchModel.deleteOne).toHaveBeenCalledWith(
      { _id: staleOwnerId, assemblyStatus: 'BUILDING' },
      expect.anything(),
    );
    // Exactly one retry — the initial attempt plus one retry, never a loop.
    expect(lockModel.insertMany).toHaveBeenCalledTimes(2);
  });

  it('acquires locks in deterministic (sorted) order regardless of request order', async () => {
    const [smaller, larger] = [ulbAId.toString(), ulbBId.toString()].sort();
    ulbModel.find.mockReturnValue(
      q([
        { _id: new Types.ObjectId(smaller), name: 'A', censusCode: '1', sbCode: null },
        { _id: new Types.ObjectId(larger), name: 'B', censusCode: '2', sbCode: null },
      ]),
    );
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(
      new Map([
        [smaller, allocation],
        [larger, allocation],
      ]),
    );
    batchUlbModel.find.mockReturnValue(
      q([
        persistedChild({ ulbId: new Types.ObjectId(smaller) }),
        persistedChild({ ulbId: new Types.ObjectId(larger) }),
      ]),
    );
    lockModel.find.mockReturnValue(q([{ ulbId: new Types.ObjectId(smaller) }, { ulbId: new Types.ObjectId(larger) }]));

    // Reversed request order — descending instead of ascending.
    await service.createDraft(
      baseInput({
        ulbSelections: [
          { ulbId: larger, claimedAmount: 100 },
          { ulbId: smaller, claimedAmount: 100 },
        ],
      }),
    );

    const [insertedLocks] = lockModel.insertMany.mock.calls[0] as [Array<{ ulbId: Types.ObjectId }>];
    expect(insertedLocks.map((l) => l.ulbId.toString())).toEqual([smaller, larger]);
  });

  // ─── Step 3: eligibility / allocation / variance validation ─────────────────

  it('throws BadRequestException and rolls back when the state-level gate fails', async () => {
    eligibilityService.evaluateStateLevelGate.mockResolvedValue({
      sources: [{ result: 'FAILED', reasonCode: 'FORM_STATUS_2_NOT_ACCEPTED' }],
      passed: false,
    });

    await expect(service.createDraft(baseInput())).rejects.toThrow(BadRequestException);
    expect(batchModel.deleteOne).toHaveBeenCalledWith({ _id: parentId, assemblyStatus: 'BUILDING' }, expect.anything());
    // Short-circuit: resolveUlbLevelEligibility (the heaviest fetch — a bulk find per
    // ULB-bulk-evaluable source) must never run once the state gate has already failed.
    expect(eligibilityService.resolveUlbLevelEligibility).not.toHaveBeenCalled();
  });

  it('throws BadRequestException and rolls back when a selected ULB has no Devolution allocation', async () => {
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());

    await expect(service.createDraft(baseInput())).rejects.toThrow(BadRequestException);
    expect(batchModel.deleteOne).toHaveBeenCalled();
  });

  it('throws BadRequestException and rolls back when a selected ULB fails a new per-ULB criterion (SLB, Annual Accounts, etc.)', async () => {
    eligibilityService.resolveUlbLevelEligibility.mockResolvedValue({
      perUlbEligible: new Map([[ulbAId.toString(), false]]),
    });

    await expect(service.createDraft(baseInput())).rejects.toThrow(BadRequestException);
    expect(batchModel.deleteOne).toHaveBeenCalled();
  });

  it('throws BadRequestException and rolls back when a claimed amount is outside the ±10% band', async () => {
    await expect(
      service.createDraft(baseInput({ ulbSelections: [{ ulbId: ulbAId.toString(), claimedAmount: 200 }] })),
    ).rejects.toThrow(BadRequestException);
    expect(batchModel.deleteOne).toHaveBeenCalled();
  });

  it('identifies an invalid ULB by censusCode in the error message, not its raw Mongo id', async () => {
    let thrown: BadRequestException | undefined;
    try {
      await service.createDraft(baseInput({ ulbSelections: [{ ulbId: ulbAId.toString(), claimedAmount: 200 }] }));
    } catch (err) {
      thrown = err as BadRequestException;
    }
    expect(thrown?.message).toContain('111');
    expect(thrown?.message).not.toContain(ulbAId.toString());
  });

  it('inserts children in chunks, never one giant array (chunk-boundary correctness)', async () => {
    const selections = Array.from({ length: 201 }, () => ({
      ulbId: new Types.ObjectId().toString(),
      claimedAmount: 100,
    }));
    const ulbDocs = selections.map((s) => ({
      _id: new Types.ObjectId(s.ulbId),
      name: 'X',
      censusCode: null,
      sbCode: null,
    }));
    ulbModel.find.mockReturnValue(q(ulbDocs));
    const allocMap = new Map(selections.map((s) => [s.ulbId, allocation]));
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(allocMap);
    batchUlbModel.find.mockReturnValue(
      q(selections.map((s) => persistedChild({ ulbId: new Types.ObjectId(s.ulbId) }))),
    );
    lockModel.find.mockReturnValue(q(selections.map((s) => ({ ulbId: new Types.ObjectId(s.ulbId) }))));

    await service.createDraft(baseInput({ ulbSelections: selections }));

    // 201 children at a 200-chunk size -> 2 bulkWrite calls.
    expect(batchUlbModel.bulkWrite).toHaveBeenCalledTimes(2);
  });

  it('builds each child document with every field required by the schema, including the nested devolutionSource.allocatedAmount', async () => {
    await service.createDraft(baseInput());

    const [ops] = batchUlbModel.bulkWrite.mock.calls[0] as [
      Array<{ insertOne: { document: Record<string, unknown> } }>,
    ];
    const document = ops[0].insertOne.document;
    const devolutionSource = document['devolutionSource'] as Record<string, unknown>;

    expect(devolutionSource['allocatedAmount']).toBe(allocation.allocatedAmount);
    expect(devolutionSource['formDocumentId']).toBeDefined();
    expect(devolutionSource['rowDocumentId']).toBeDefined();
    expect(devolutionSource['datasetVersion']).toBe(allocation.datasetVersion);
    expect(devolutionSource['installment']).toBe(1);
  });

  it('freezes real per-ULB row evidence onto eligibilitySources for a FORM_AND_ROW source, instead of []', async () => {
    const electedBodyFormJsonId = new Types.ObjectId();
    const electedBodyFormDocId = new Types.ObjectId();
    const electedBodyRowId = new Types.ObjectId();
    const electedBodySource = {
      formId: 23,
      formJsonId: electedBodyFormJsonId.toString(),
      ruleVersion: 1,
      formType: 'ELECTED_BODY',
      ownerLevel: 'STATE',
      evaluationLevel: 'FORM_AND_ROW',
      formDocumentId: electedBodyFormDocId.toString(),
      statusAtEvaluation: 7,
      result: 'PASSED',
      reasonCode: 'FORM_STATUS_ACCEPTED',
      evidence: {
        evidenceVersion: 1,
        resolvedFormStatus: 7,
        acceptedFormStatuses: [5, 7],
        sourceFormDocumentId: electedBodyFormDocId.toString(),
        evaluatedAt: new Date().toISOString(),
      },
    };
    eligibilityService.evaluateStateLevelGate.mockResolvedValue({ sources: [electedBodySource], passed: true });
    eligibilityService.resolveUlbLevelEligibility.mockResolvedValue({
      perUlbEligible: new Map([[ulbAId.toString(), true]]),
      rowEvidenceByFormId: new Map([
        [
          23,
          new Map([
            [
              ulbAId.toString(),
              {
                bucket: 'ELIGIBLE',
                rowDocumentId: electedBodyRowId.toString(),
                rowStatusAtEvaluation: 7,
                datasetVersion: 4,
              },
            ],
          ]),
        ],
      ]),
    });

    await service.createDraft(baseInput());

    const [ops] = batchUlbModel.bulkWrite.mock.calls[0] as [
      Array<{ insertOne: { document: Record<string, unknown> } }>,
    ];
    const eligibilitySources = ops[0].insertOne.document['eligibilitySources'] as Record<string, unknown>[];

    expect(eligibilitySources).toHaveLength(1);
    expect(eligibilitySources[0]).toMatchObject({
      formId: 23,
      formDocumentId: electedBodyFormDocId,
      rowDocumentId: electedBodyRowId,
      statusAtEvaluation: 7,
      rowStatusAtEvaluation: 7,
      datasetVersion: 4,
      result: 'PASSED',
      reasonCode: 'ROW_STATUS_ACCEPTED',
    });
  });

  it('freezes rowDocumentId: null with reasonCode ROW_DEFAULT_NO_ROW when a ULB has no row evidence for a FORM_AND_ROW source', async () => {
    const electedBodyFormJsonId = new Types.ObjectId();
    const electedBodyFormDocId = new Types.ObjectId();
    const electedBodySource = {
      formId: 23,
      formJsonId: electedBodyFormJsonId.toString(),
      ruleVersion: 1,
      formType: 'ELECTED_BODY',
      ownerLevel: 'STATE',
      evaluationLevel: 'FORM_AND_ROW',
      formDocumentId: electedBodyFormDocId.toString(),
      statusAtEvaluation: 7,
      result: 'PASSED',
      reasonCode: 'FORM_STATUS_ACCEPTED',
      evidence: {
        evidenceVersion: 1,
        resolvedFormStatus: 7,
        acceptedFormStatuses: [5, 7],
        sourceFormDocumentId: electedBodyFormDocId.toString(),
        evaluatedAt: new Date().toISOString(),
      },
    };
    eligibilityService.evaluateStateLevelGate.mockResolvedValue({ sources: [electedBodySource], passed: true });
    eligibilityService.resolveUlbLevelEligibility.mockResolvedValue({
      perUlbEligible: new Map([[ulbAId.toString(), true]]),
      rowEvidenceByFormId: new Map([[23, new Map()]]), // no entry for ulbA — defaultWhenNoRow applied
    });

    await service.createDraft(baseInput());

    const [ops] = batchUlbModel.bulkWrite.mock.calls[0] as [
      Array<{ insertOne: { document: Record<string, unknown> } }>,
    ];
    const eligibilitySources = ops[0].insertOne.document['eligibilitySources'] as Record<string, unknown>[];

    expect(eligibilitySources[0]).toMatchObject({
      rowDocumentId: null,
      rowStatusAtEvaluation: null,
      result: 'PASSED',
      reasonCode: 'ROW_DEFAULT_NO_ROW',
    });
  });

  it('recovers cleanly when a chunk insert fails mid-flight (does not leave the parent READY)', async () => {
    batchUlbModel.bulkWrite.mockRejectedValue(new Error('insert failed'));

    await expect(service.createDraft(baseInput())).rejects.toThrow('insert failed');

    expect(batchUlbModel.deleteMany).toHaveBeenCalledWith({ claimLetter: parentId }, expect.anything());
    const [lockDeleteFilter] = lockModel.deleteMany.mock.calls[0] as [
      { claimLetter: Types.ObjectId; buildRequestId: string },
    ];
    expect(lockDeleteFilter.claimLetter).toBe(parentId);
    expect(typeof lockDeleteFilter.buildRequestId).toBe('string');
    expect(batchModel.deleteOne).toHaveBeenCalledWith({ _id: parentId, assemblyStatus: 'BUILDING' }, expect.anything());
    expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  // ─── Step 4: revalidation / verification / finalize ─────────────────────────

  it('aborts the build when the eligibility gate drifts between build and revalidation', async () => {
    eligibilityService.evaluateStateLevelGate
      .mockResolvedValueOnce({ sources: [], passed: true }) // used to build
      .mockResolvedValueOnce({ sources: [{ result: 'FAILED', reasonCode: 'X' }], passed: false }); // revalidation

    await expect(service.createDraft(baseInput())).rejects.toThrow(ConflictException);
    expect(batchModel.deleteOne).toHaveBeenCalled();
    expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('aborts the build when a used allocation changes between build and revalidation', async () => {
    eligibilityService.resolveDevolutionAllocations
      .mockResolvedValueOnce(new Map([[ulbAId.toString(), allocation]])) // used to build
      .mockResolvedValueOnce(new Map([[ulbAId.toString(), { ...allocation, allocatedAmount: 50 }]])); // revalidation

    await expect(service.createDraft(baseInput())).rejects.toThrow(ConflictException);
    expect(batchModel.deleteOne).toHaveBeenCalled();
  });

  it('aborts when the persisted child count does not match the requested selection (incomplete assembly)', async () => {
    batchUlbModel.find.mockReturnValue(q([])); // nothing actually persisted

    await expect(service.createDraft(baseInput())).rejects.toThrow(ConflictException);
    expect(batchModel.deleteOne).toHaveBeenCalled();
  });

  it('aborts when a selected ULB has no matching lock at verification time', async () => {
    lockModel.find.mockReturnValue(q([])); // lock missing

    await expect(service.createDraft(baseInput())).rejects.toThrow(ConflictException);
    expect(batchModel.deleteOne).toHaveBeenCalled();
  });

  it('finalizes with an expected-state filter and records create-draft history inside the same transaction', async () => {
    await service.createDraft(baseInput());

    const [filter, update, options] = batchModel.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
      Record<string, unknown>,
    ];
    expect(filter).toMatchObject({ _id: parentId, assemblyStatus: 'BUILDING' });
    expect(update.$set).toMatchObject({ assemblyStatus: 'READY' });
    expect(update.$set['contentHash']).toEqual(expect.any(String));
    expect(options['session']).toBe(session);

    expect(historyService.recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: null, toStatus: 2, actionSource: 'DIRECT_STATE_REVIEW' }),
      session,
    );
    expect(session.commitTransaction).toHaveBeenCalled();
  });

  it('treats a duplicate finalization (null findOneAndUpdate result) as a safe no-op, returning the current READY doc', async () => {
    batchModel.findOneAndUpdate.mockReturnValue(q(null));
    batchModel.findById.mockReturnValue(
      q({ _id: parentId, assemblyStatus: 'READY', financialSummary: zeroFinancialSummary }),
    );

    const result = await service.createDraft(baseInput());

    expect(result.claimLetterId).toBe(String(parentId));
    expect(historyService.recordTransition).not.toHaveBeenCalled();
  });

  it('throws ConflictException when finalization returns null and no READY doc can be found either', async () => {
    batchModel.findOneAndUpdate.mockReturnValue(q(null));
    batchModel.findById.mockReturnValue(q(null));

    await expect(service.createDraft(baseInput())).rejects.toThrow(ConflictException);
  });

  // ─── updateDraft ─────────────────────────────────────────────────────────────

  describe('updateDraft', () => {
    it('throws NotFoundException when no READY claim matches the id', async () => {
      batchModel.findOne.mockReturnValue(q(null));
      await expect(
        service.updateDraft(parentId.toString(), [{ ulbId: ulbAId.toString(), claimedAmount: 100 }], 0, stateUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for a STATE user requesting a different state', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      const otherStateUser: AuthUser = { ...stateUser, state: new Types.ObjectId().toString() };
      await expect(
        service.updateDraft(parentId.toString(), [{ ulbId: ulbAId.toString(), claimedAmount: 100 }], 0, otherStateUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when the draft is not IN_PROGRESS', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc({ currentFormStatus: 5 })));
      // The atomic edit-lock claim's filter requires currentFormStatus: IN_PROGRESS, so a real DB
      // wouldn't match this doc — simulate that by having the claim miss, then the differentiated
      // re-fetch see the same non-IN_PROGRESS state.
      batchModel.findOneAndUpdate.mockReturnValueOnce(q(null));
      batchModel.findById.mockReturnValue(q(parentDoc({ currentFormStatus: 5 })));
      await expect(
        service.updateDraft(parentId.toString(), [{ ulbId: ulbAId.toString(), claimedAmount: 100 }], 0, stateUser),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException on a stale revision', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc({ revision: 3 })));
      batchModel.findOneAndUpdate.mockReturnValueOnce(q(null));
      batchModel.findById.mockReturnValue(q(parentDoc({ revision: 3 })));
      await expect(
        service.updateDraft(parentId.toString(), [{ ulbId: ulbAId.toString(), claimedAmount: 100 }], 0, stateUser),
      ).rejects.toThrow(ConflictException);
    });

    it('throws a specific ConflictException when another update is already in flight', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate.mockReturnValueOnce(q(null));
      // A *fresh* (unexpired) lock — this is the "someone else is actively editing" case.
      batchModel.findById.mockReturnValue(
        q(parentDoc({ editLockToken: 'some-other-token', editLockAcquiredAt: new Date() })),
      );
      await expect(
        service.updateDraft(parentId.toString(), [{ ulbId: ulbAId.toString(), claimedAmount: 100 }], 0, stateUser),
      ).rejects.toThrow(/currently being edited/i);
    });

    it('treats an expired edit lock as unclaimed rather than "currently being edited"', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate.mockReturnValueOnce(q(null));
      // A lock acquired an hour ago is well past the 5-minute lease — the claim query itself would
      // have matched a real DB in this state, so this failure must be attributed to something else
      // (here, nothing else is wrong, so it falls through to the generic conflict message).
      batchModel.findById.mockReturnValue(
        q(parentDoc({ editLockToken: 'some-stale-token', editLockAcquiredAt: new Date(Date.now() - 60 * 60_000) })),
      );
      await expect(
        service.updateDraft(parentId.toString(), [{ ulbId: ulbAId.toString(), claimedAmount: 100 }], 0, stateUser),
      ).rejects.not.toThrow(/currently being edited/i);
    });

    it('claims the edit lock atomically before touching any child rows', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate.mockReturnValueOnce(q(parentDoc()));
      batchUlbModel.find.mockReturnValue(q([persistedChild({ ulbId: ulbAId })]));
      lockModel.find.mockReturnValue(q([{ ulbId: ulbAId }]));

      await service.updateDraft(parentId.toString(), [{ ulbId: ulbAId.toString(), claimedAmount: 100 }], 0, stateUser);

      const [claimFilter, claimUpdate] = batchModel.findOneAndUpdate.mock.calls[0] as [
        Record<string, unknown>,
        { $set: Record<string, unknown> },
      ];
      expect(claimFilter).toMatchObject({
        _id: parentId.toString(),
        assemblyStatus: 'READY',
        currentFormStatus: 2,
        revision: 0,
      });
      // Self-expiring lease, not a bare null check — a stale claim must be reclaimable inline.
      expect(claimFilter['$or']).toEqual([{ editLockToken: null }, { editLockAcquiredAt: { $lt: expect.any(Date) } }]);
      expect(typeof claimUpdate.$set['editLockToken']).toBe('string');
    });

    it('rejects an empty selection before touching locks', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      await expect(service.updateDraft(parentId.toString(), [], 0, stateUser)).rejects.toThrow(BadRequestException);
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('rejects a duplicate ULB within the new selection', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      await expect(
        service.updateDraft(
          parentId.toString(),
          [
            { ulbId: ulbAId.toString(), claimedAmount: 100 },
            { ulbId: ulbAId.toString(), claimedAmount: 100 },
          ],
          0,
          stateUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('diffs locks correctly: releases removed ULBs, acquires added ULBs, leaves retained ULBs untouched', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate.mockReturnValueOnce(q(parentDoc()));
      // First call (currentChildren, before the diff) sees the pre-update set: ulbA only.
      // Second call (persistedChildren, in verify) sees the post-rebuild set: ulbB only —
      // matching the new selection (a pure replace: drop ulbA, add ulbB).
      batchUlbModel.find
        .mockReturnValueOnce(q([{ ulbId: ulbAId }]))
        .mockReturnValueOnce(q([persistedChild({ ulbId: ulbBId })]));
      ulbModel.find.mockReturnValue(q([{ _id: ulbBId, name: 'Beta ULB', censusCode: '222', sbCode: null }]));
      eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map([[ulbBId.toString(), allocation]]));
      lockModel.find.mockReturnValue(q([{ ulbId: ulbBId }]));

      await service.updateDraft(parentId.toString(), [{ ulbId: ulbBId.toString(), claimedAmount: 100 }], 0, stateUser);

      expect(lockModel.deleteMany).toHaveBeenCalledWith(
        { claimLetter: parentId, ulbId: { $in: [ulbAId] } },
        expect.anything(),
      );
      const [insertedLocks] = lockModel.insertMany.mock.calls[0] as [Array<{ ulbId: Types.ObjectId }>];
      expect(insertedLocks.map((l) => l.ulbId.toString())).toEqual([ulbBId.toString()]);
    });

    it('rejects and rolls back the lock diff when an added ULB is already locked elsewhere', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate.mockReturnValueOnce(q(parentDoc()));
      batchUlbModel.find.mockReturnValue(q([{ ulbId: ulbAId }]));
      lockModel.insertMany.mockRejectedValue(duplicateKeyError());

      await expect(
        service.updateDraft(parentId.toString(), [{ ulbId: ulbBId.toString(), claimedAmount: 100 }], 0, stateUser),
      ).rejects.toThrow(/already locked/i);
      expect(session.abortTransaction).toHaveBeenCalled();
      expect(batchUlbModel.deleteMany).not.toHaveBeenCalled();
      // diffLocks itself failed (its own transaction already rolled back) — the edit-lock claim
      // still must be released so this draft isn't permanently un-editable.
      expect(batchModel.updateOne).toHaveBeenCalledWith(
        { _id: parentId, editLockToken: expect.any(String) },
        { $set: { editLockToken: null, editLockAcquiredAt: null } },
      );
    });

    it('increments revision and updates financialSummary/contentHash on success', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate
        .mockReturnValueOnce(q(parentDoc())) // the upfront edit-lock claim
        .mockReturnValueOnce(
          q({ _id: parentId, revision: 1, currentFormStatus: 2, financialSummary: zeroFinancialSummary }),
        ); // the finalize
      // Both the currentChildren lookup and the persistedChildren verify use the full shape —
      // the selection is unchanged (ulbA only), so no lock diff and the same set persists.
      batchUlbModel.find.mockReturnValue(q([persistedChild({ ulbId: ulbAId })]));
      lockModel.find.mockReturnValue(q([{ ulbId: ulbAId }]));

      const result = await service.updateDraft(
        parentId.toString(),
        [{ ulbId: ulbAId.toString(), claimedAmount: 100 }],
        0,
        stateUser,
      );

      expect(result).toMatchObject({ claimLetterId: String(parentId), revision: 1, currentFormStatus: 2 });
      const [finalizeFilter, finalizeUpdate] = batchModel.findOneAndUpdate.mock.calls[1] as [
        Record<string, unknown>,
        { $set: Record<string, unknown>; $inc: Record<string, unknown> },
      ];
      expect(finalizeFilter).toMatchObject({ _id: parentId, currentFormStatus: 2 });
      expect(typeof finalizeFilter['editLockToken']).toBe('string');
      expect(finalizeUpdate.$set).toMatchObject({ editLockToken: null, editLockAcquiredAt: null });
      expect(finalizeUpdate.$inc).toEqual({ revision: 1 });
      expect(historyService.recordTransition).not.toHaveBeenCalled();
    });

    // ─── Data-loss/false-conflict regression coverage ───────────────────────
    // updateDraftRaw used to delete the existing children before validating the new selection,
    // so a business-rule rejection or a post-persist verification failure would permanently wipe
    // a previously valid draft with nothing to restore it. These tests cover the fix.

    it('does not delete existing children when the new selection fails validation', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate.mockReturnValueOnce(q(parentDoc()));
      batchUlbModel.find.mockReturnValue(q([persistedChild({ ulbId: ulbAId })]));
      lockModel.find.mockReturnValue(q([{ ulbId: ulbAId }]));
      eligibilityService.resolveUlbLevelEligibility.mockResolvedValue({
        perUlbEligible: new Map([[ulbAId.toString(), false]]),
      });

      await expect(
        service.updateDraft(parentId.toString(), [{ ulbId: ulbAId.toString(), claimedAmount: 100 }], 0, stateUser),
      ).rejects.toThrow(BadRequestException);

      expect(batchUlbModel.deleteMany).not.toHaveBeenCalled();
    });

    it('restores the previous children when persisting the new set fails after the old set was deleted', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate.mockReturnValueOnce(q(parentDoc()));
      const oldChild = persistedChild({ ulbId: ulbAId });
      batchUlbModel.find.mockReturnValue(q([oldChild]));
      ulbModel.find.mockReturnValue(q([{ _id: ulbBId, name: 'Beta ULB', censusCode: '222', sbCode: null }]));
      eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map([[ulbBId.toString(), allocation]]));
      batchUlbModel.bulkWrite.mockRejectedValueOnce(new Error('insert failed')).mockResolvedValue({});

      await expect(
        service.updateDraft(parentId.toString(), [{ ulbId: ulbBId.toString(), claimedAmount: 100 }], 0, stateUser),
      ).rejects.toThrow('insert failed');

      expect(batchUlbModel.deleteMany).toHaveBeenCalledWith({ claimLetter: parentId });
      expect(batchUlbModel.bulkWrite).toHaveBeenCalledTimes(2);
      const [restoreOps] = batchUlbModel.bulkWrite.mock.calls[1] as [
        Array<{ insertOne: { document: Record<string, unknown> } }>,
      ];
      expect(String(restoreOps[0].insertOne.document['ulbId'])).toBe(ulbAId.toString());
    });

    it('restores the previous children when post-persist verification fails', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate.mockReturnValueOnce(q(parentDoc()));
      const oldChild = persistedChild({ ulbId: ulbAId });
      batchUlbModel.find
        .mockReturnValueOnce(q([oldChild])) // currentChildren, before the edit
        .mockReturnValueOnce(q([])); // persistedChildren re-fetch inside verify — nothing there

      await expect(
        service.updateDraft(parentId.toString(), [{ ulbId: ulbAId.toString(), claimedAmount: 100 }], 0, stateUser),
      ).rejects.toThrow(ConflictException);

      expect(batchUlbModel.deleteMany).toHaveBeenCalledTimes(2);
      expect(batchUlbModel.bulkWrite).toHaveBeenCalledTimes(2);
      const [restoreOps] = batchUlbModel.bulkWrite.mock.calls[1] as [
        Array<{ insertOne: { document: Record<string, unknown> } }>,
      ];
      expect(String(restoreOps[0].insertOne.document['ulbId'])).toBe(ulbAId.toString());
    });
  });

  // ─── abandonDraft ────────────────────────────────────────────────────────────

  describe('abandonDraft', () => {
    it('throws NotFoundException when no READY claim matches the id', async () => {
      batchModel.findOne.mockReturnValue(q(null));
      await expect(service.abandonDraft(parentId.toString(), stateUser)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for a STATE user requesting a different state', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      const otherStateUser: AuthUser = { ...stateUser, state: new Types.ObjectId().toString() };
      await expect(service.abandonDraft(parentId.toString(), otherStateUser)).rejects.toThrow(ForbiddenException);
    });

    it('is idempotent: returns the current doc without touching locks when already abandoned', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc({ isAbandoned: true })));

      const result = await service.abandonDraft(parentId.toString(), stateUser);

      expect(result).toMatchObject({ isAbandoned: true });
      expect(connection.startSession).not.toHaveBeenCalled();
      expect(historyService.recordTransition).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the draft is not IN_PROGRESS and not already abandoned', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc({ currentFormStatus: 5 })));
      await expect(service.abandonDraft(parentId.toString(), stateUser)).rejects.toThrow(ConflictException);
    });

    it('deletes only ACTIVE locks for this claim and records history inside one transaction', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate.mockReturnValue(
        q({
          _id: parentId,
          state: stateId,
          year: yearId,
          installment: 1,
          batchNumber: 1,
          version: 1,
          isAbandoned: true,
          financialSummary: zeroFinancialSummary,
        }),
      );

      const result = await service.abandonDraft(parentId.toString(), stateUser);

      expect(lockModel.deleteMany).toHaveBeenCalledWith(
        { claimLetter: parentId, lockState: 'ACTIVE' },
        expect.anything(),
      );
      expect(historyService.recordTransition).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'ABANDONED_BY_STATE', fromStatus: 2, toStatus: 2 }),
        session,
      );
      expect(session.commitTransaction).toHaveBeenCalled();
      expect(result).toMatchObject({ isAbandoned: true, currentFormStatusLabel: 'Abandoned' });
    });

    it('treats a concurrent race (findOneAndUpdate returns null) as idempotent if the doc is already abandoned', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      batchModel.findById.mockReturnValue(q(parentDoc({ isAbandoned: true })));

      const result = await service.abandonDraft(parentId.toString(), stateUser);

      expect(result).toMatchObject({ isAbandoned: true });
      expect(lockModel.deleteMany).not.toHaveBeenCalled();
      expect(historyService.recordTransition).not.toHaveBeenCalled();
    });

    it('throws ConflictException when findOneAndUpdate returns null and the doc still is not abandoned', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      batchModel.findById.mockReturnValue(q(parentDoc({ isAbandoned: false })));

      await expect(service.abandonDraft(parentId.toString(), stateUser)).rejects.toThrow(ConflictException);
    });

    it('throws a specific ConflictException when an updateDraft call is currently mid-rebuild', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      // The atomic abandon guard now also requires the edit lock to be absent/expired — simulate a
      // real DB rejecting the match because an update currently holds a *fresh* (unexpired) lock.
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      batchModel.findById.mockReturnValue(
        q(parentDoc({ editLockToken: 'some-update-token', editLockAcquiredAt: new Date() })),
      );

      await expect(service.abandonDraft(parentId.toString(), stateUser)).rejects.toThrow(/currently being edited/i);
    });

    it('treats an expired edit lock as unclaimed and abandons successfully', async () => {
      batchModel.findOne.mockReturnValue(q(parentDoc()));
      batchModel.findOneAndUpdate.mockReturnValue(
        q({
          _id: parentId,
          state: stateId,
          year: yearId,
          installment: 1,
          batchNumber: 1,
          version: 1,
          isAbandoned: true,
          financialSummary: zeroFinancialSummary,
        }),
      );

      const result = await service.abandonDraft(parentId.toString(), stateUser);

      expect(result).toMatchObject({ isAbandoned: true });
      const [filter] = batchModel.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>];
      expect(filter['$or']).toEqual([{ editLockToken: null }, { editLockAcquiredAt: { $lt: expect.any(Date) } }]);
    });
  });

  // ─── createNewVersion (mechanism only, no caller in V1 — docs/adr/0003-workflow-transitions.md) ──

  describe('createNewVersion', () => {
    const newParentId = new Types.ObjectId();

    function previousParentDoc(overrides: Record<string, unknown> = {}) {
      return {
        _id: parentId,
        state: stateId,
        year: yearId,
        installment: 1,
        batchNumber: 1,
        version: 1,
        currentFormStatus: 6, // RETURNED_BY_MOHUA
        assemblyStatus: 'READY',
        isAbandoned: false,
        ...overrides,
      };
    }

    it('throws NotFoundException when no READY claim matches previousClaimId', async () => {
      batchModel.findOne.mockReturnValue(q(null));
      await expect(service.createNewVersion(parentId.toString(), 'reason', stateUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException for a STATE user requesting a different state', async () => {
      batchModel.findOne.mockReturnValue(q(previousParentDoc()));
      const otherStateUser: AuthUser = { ...stateUser, state: new Types.ObjectId().toString() };
      await expect(service.createNewVersion(parentId.toString(), 'reason', otherStateUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ConflictException when the previous claim is abandoned', async () => {
      batchModel.findOne.mockReturnValue(q(previousParentDoc({ isAbandoned: true })));
      await expect(service.createNewVersion(parentId.toString(), 'reason', stateUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when the previous claim has reached a terminal status', async () => {
      batchModel.findOne.mockReturnValue(q(previousParentDoc({ currentFormStatus: 7 })));
      await expect(service.createNewVersion(parentId.toString(), 'reason', stateUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when the previous claim has no children to carry forward', async () => {
      batchModel.findOne.mockReturnValue(q(previousParentDoc()));
      batchUlbModel.find.mockReturnValueOnce(q([]));
      await expect(service.createNewVersion(parentId.toString(), 'reason', stateUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates a fresh version carrying forward the previous ULB selections, links supersession, and records history', async () => {
      batchModel.findOne.mockReturnValue(q(previousParentDoc()));
      batchModel.create.mockResolvedValue([{ _id: newParentId, batchNumber: 1, version: 2 }]);
      batchUlbModel.find
        .mockReturnValueOnce(q([{ ulbId: ulbAId, claimedAmount: 100 }])) // previousChildren
        .mockReturnValueOnce(q([persistedChild({ claimLetter: newParentId, version: 2 })])); // new persisted children
      lockModel.find.mockReturnValue(q([{ ulbId: ulbAId }]));
      batchModel.findOneAndUpdate.mockReturnValue(
        q({ _id: newParentId, assemblyStatus: 'READY', batchNumber: 1, version: 2, supersedes: parentId }),
      );

      const result = await service.createNewVersion(parentId.toString(), 'MoHUA rejected the claim', stateUser);

      expect(result).toMatchObject({ _id: newParentId, version: 2 });

      const [createArgs] = batchModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
      expect(createArgs[0]).toMatchObject({ batchNumber: 1, version: 2, supersedes: parentId });

      expect(batchModel.updateOne).toHaveBeenCalledWith(
        { _id: parentId },
        { $set: { supersededBy: newParentId } },
        expect.anything(),
      );
      expect(historyService.recordTransition).toHaveBeenCalledWith(
        expect.objectContaining({ fromStatus: null, toStatus: 2, reason: 'MoHUA rejected the claim' }),
        session,
      );
      expect(session.commitTransaction).toHaveBeenCalled();
    });

    it('surfaces a clear conflict when the {batchNumber,version} slot was already regenerated by a concurrent request', async () => {
      batchModel.findOne.mockReturnValue(q(previousParentDoc()));
      batchUlbModel.find.mockReturnValueOnce(q([{ ulbId: ulbAId, claimedAmount: 100 }]));
      batchModel.create.mockRejectedValue(duplicateKeyError());

      await expect(service.createNewVersion(parentId.toString(), 'reason', stateUser)).rejects.toThrow(
        /already regenerated/i,
      );
      expect(session.abortTransaction).toHaveBeenCalled();
    });

    it('surfaces a clear conflict when a carried-forward ULB is already locked elsewhere', async () => {
      batchModel.findOne.mockReturnValue(q(previousParentDoc()));
      batchUlbModel.find.mockReturnValueOnce(q([{ ulbId: ulbAId, claimedAmount: 100 }]));
      lockModel.insertMany.mockRejectedValue(duplicateKeyError());

      await expect(service.createNewVersion(parentId.toString(), 'reason', stateUser)).rejects.toThrow(
        /already locked/i,
      );
      expect(session.abortTransaction).toHaveBeenCalled();
    });
  });

  // ─── acknowledgeLocks (mechanism only, no caller in V1 — docs/adr/0003-workflow-transitions.md) ──

  describe('acknowledgeLocks', () => {
    it('converts only ACTIVE locks for this claim to ACKNOWLEDGED, scoped by claimLetter', async () => {
      await service.acknowledgeLocks(parentId.toString());

      expect(lockModel.updateMany).toHaveBeenCalledWith(
        { claimLetter: parentId, lockState: 'ACTIVE' },
        { $set: { lockState: 'ACKNOWLEDGED' } },
        { session: undefined },
      );
    });

    it('accepts an ObjectId directly and passes the session through when provided', async () => {
      const providedSession = {} as never;
      await service.acknowledgeLocks(parentId, providedSession);

      expect(lockModel.updateMany).toHaveBeenCalledWith(
        { claimLetter: parentId, lockState: 'ACTIVE' },
        { $set: { lockState: 'ACKNOWLEDGED' } },
        { session: providedSession },
      );
    });
  });

  // ─── Structural guard: never read the display-only eligibility cache ────────

  it('never calls the cached *ForDisplay eligibility variants — this pipeline authorizes builds and must always read live data', () => {
    // buildChildren()'s eligibility check and assertNoDrift()'s re-check exist specifically to
    // catch eligibility changing during/around the chunked, non-transactional child-insertion
    // window (docs/adr/0002-batching-and-locks.md) — reading from ClaimLetterEligibilityService's cached
    // evaluateStateLevelGateForDisplay/resolveUlbLevelEligibilityForDisplay here would let a state
    // build a claim against stale eligibility and would silently defeat assertNoDrift's entire
    // purpose (see claim-letter-eligibility.service.ts's doc comments on those two methods).
    const serviceSource = ClaimLetterAssemblyService.toString();
    expect(serviceSource).not.toMatch(/ForDisplay/);
  });
});
