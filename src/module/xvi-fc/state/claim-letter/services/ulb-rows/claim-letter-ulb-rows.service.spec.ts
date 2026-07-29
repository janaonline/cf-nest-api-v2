import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ClaimLetterUlbRowsService } from './claim-letter-ulb-rows.service';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'lean']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('ClaimLetterUlbRowsService', () => {
  let service: ClaimLetterUlbRowsService;
  let eligibilityService: { evaluateStateLevelGate: jest.Mock; resolveUlbLevelEligibility: jest.Mock };
  let batchModel: { findOne: jest.Mock };
  let batchUlbModel: { find: jest.Mock; countDocuments: jest.Mock };

  const claimLetterId = new Types.ObjectId().toString();
  const stateId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const stateUser: AuthUser = {
    _id: 'u1',
    role: 'STATE',
    scope: Scope.STATE,
    accessLevel: null,
    state: stateId.toString(),
  };

  const financialSummary = {
    totalInstallmentAllocation: 0,
    totalAlreadyAcknowledged: 0,
    selectedAllocation: 0,
    currentSelectedClaim: 0,
    remainingIfAcknowledged: 0,
  };

  beforeEach(async () => {
    eligibilityService = {
      evaluateStateLevelGate: jest.fn().mockResolvedValue({ sources: [], passed: true }),
      resolveUlbLevelEligibility: jest.fn().mockResolvedValue({ perUlbEligible: new Map() }),
    };
    batchModel = { findOne: jest.fn() };
    batchUlbModel = {
      find: jest.fn(),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterUlbRowsService,
        { provide: ClaimLetterEligibilityService, useValue: eligibilityService },
        { provide: getModelToken(ClaimLetterBatch.name), useValue: batchModel },
        { provide: getModelToken(ClaimLetterBatchUlb.name), useValue: batchUlbModel },
      ],
    }).compile();

    service = module.get<ClaimLetterUlbRowsService>(ClaimLetterUlbRowsService);
  });

  it('throws NotFoundException when no READY claim matches the id', async () => {
    batchModel.findOne.mockReturnValue(q(null));
    await expect(service.getUlbs(claimLetterId, {}, stateUser)).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when the claim belongs to a different state', async () => {
    batchModel.findOne.mockReturnValue(
      q({ _id: claimLetterId, state: new Types.ObjectId(), year: yearId, installment: 1, financialSummary }),
    );
    batchUlbModel.find.mockReturnValue(q([]));

    await expect(service.getUlbs(claimLetterId, {}, stateUser)).rejects.toThrow(ForbiddenException);
  });

  it('maps rows from basis-points to percentage (amounts pass through unconverted) and re-verifies eligibility', async () => {
    batchModel.findOne.mockReturnValue(
      q({ _id: claimLetterId, state: stateId, year: yearId, installment: 1, financialSummary }),
    );
    const ulbId = new Types.ObjectId();
    batchUlbModel.find.mockReturnValue(
      q([
        {
          ulbId,
          ulbSnapshot: { name: 'Test ULB', censusCode: '111', sbCode: 'SB-1' },
          allocatedAmount: 1,
          claimedAmount: 1.05,
          differencePercentageBasisPoints: 500,
        },
      ]),
    );

    const result = await service.getUlbs(claimLetterId, {}, stateUser);

    expect(result.data![0]).toEqual({
      ulbId: String(ulbId),
      ulbName: 'Test ULB',
      censusCode: '111',
      sbCode: 'SB-1',
      allocationAmount: 1,
      claimAmount: 1.05,
      differencePercentage: 5,
      eligible: true,
    });
  });

  it('returns sbCode as null (not omitted) when the ULB has no census code', async () => {
    batchModel.findOne.mockReturnValue(
      q({ _id: claimLetterId, state: stateId, year: yearId, installment: 1, financialSummary }),
    );
    batchUlbModel.find.mockReturnValue(
      q([
        {
          ulbId: new Types.ObjectId(),
          ulbSnapshot: { name: 'Test ULB', censusCode: null, sbCode: null },
          allocatedAmount: 1,
          claimedAmount: 1,
          differencePercentageBasisPoints: 0,
        },
      ]),
    );

    const result = await service.getUlbs(claimLetterId, {}, stateUser);

    expect(result.data![0].censusCode).toBeNull();
    expect(result.data![0].sbCode).toBeNull();
  });

  it('reflects a failed re-verified gate as eligible: false on every row', async () => {
    batchModel.findOne.mockReturnValue(
      q({ _id: claimLetterId, state: stateId, year: yearId, installment: 1, financialSummary }),
    );
    batchUlbModel.find.mockReturnValue(
      q([
        {
          ulbId: new Types.ObjectId(),
          ulbSnapshot: { name: 'Test ULB', censusCode: '111', sbCode: null },
          allocatedAmount: 1,
          claimedAmount: 1,
          differencePercentageBasisPoints: 0,
        },
      ]),
    );
    eligibilityService.evaluateStateLevelGate.mockResolvedValue({ sources: [], passed: false });

    const result = await service.getUlbs(claimLetterId, {}, stateUser);

    expect(result.data![0].eligible).toBe(false);
  });

  it('reflects a failed per-ULB criterion (SLB, Annual Accounts, etc.) as eligible: false even when the state gate passes', async () => {
    batchModel.findOne.mockReturnValue(
      q({ _id: claimLetterId, state: stateId, year: yearId, installment: 1, financialSummary }),
    );
    const ulbId = new Types.ObjectId();
    batchUlbModel.find.mockReturnValue(
      q([
        {
          ulbId,
          ulbSnapshot: { name: 'Test ULB', censusCode: '111', sbCode: null },
          allocatedAmount: 1,
          claimedAmount: 1,
          differencePercentageBasisPoints: 0,
        },
      ]),
    );
    eligibilityService.resolveUlbLevelEligibility.mockResolvedValue({
      perUlbEligible: new Map([[String(ulbId), false]]),
    });

    const result = await service.getUlbs(claimLetterId, {}, stateUser);

    expect(result.data![0].eligible).toBe(false);
    expect(eligibilityService.resolveUlbLevelEligibility).toHaveBeenCalledWith(String(stateId), String(yearId), 1, [
      String(ulbId),
    ]);
  });

  it('returns the display-converted financialSummary in meta', async () => {
    batchModel.findOne.mockReturnValue(
      q({
        _id: claimLetterId,
        state: stateId,
        year: yearId,
        installment: 1,
        financialSummary: { ...financialSummary, selectedAllocation: 2 },
      }),
    );
    batchUlbModel.find.mockReturnValue(q([]));

    const result = await service.getUlbs(claimLetterId, {}, stateUser);

    expect((result.meta!['financialSummary'] as { selectedAllocation: number }).selectedAllocation).toBe(2);
  });

  it('builds a name/censusCode/sbCode search filter when search is provided', async () => {
    batchModel.findOne.mockReturnValue(
      q({ _id: claimLetterId, state: stateId, year: yearId, installment: 1, financialSummary }),
    );
    batchUlbModel.find.mockReturnValue(q([]));

    await service.getUlbs(claimLetterId, { search: 'test' }, stateUser);

    const [filter] = batchUlbModel.find.mock.calls[0] as [Record<string, unknown>];
    expect(filter['$or']).toEqual([
      { 'ulbSnapshot.name': expect.any(RegExp) },
      { 'ulbSnapshot.censusCode': expect.any(RegExp) },
      { 'ulbSnapshot.sbCode': expect.any(RegExp) },
    ]);
  });
});
