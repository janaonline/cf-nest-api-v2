import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ClaimLetterUlbOptionsService } from './claim-letter-ulb-options.service';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterUlbLock } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import type { EligibilityEvaluationResult } from 'src/module/xvi-fc/common/types/claim-eligibility.type';

function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  chain['select'] = jest.fn().mockReturnValue(chain);
  chain['lean'] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('ClaimLetterUlbOptionsService', () => {
  let service: ClaimLetterUlbOptionsService;
  let expectedUlbSetService: { resolve: jest.Mock };
  let eligibilityService: { evaluateStateLevelGate: jest.Mock; resolveDevolutionAllocations: jest.Mock };
  let lockModel: { find: jest.Mock };

  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const stateUser: AuthUser = { _id: 'u1', role: 'STATE', scope: Scope.STATE, accessLevel: null, state: stateId };

  const ulbA = { ulbId: new Types.ObjectId().toString(), name: 'Alpha ULB', censusCode: '111', sbCode: null };
  const ulbB = { ulbId: new Types.ObjectId().toString(), name: 'Beta ULB', censusCode: '222', sbCode: null };

  function passedGate(): { sources: EligibilityEvaluationResult[]; passed: boolean } {
    return { sources: [], passed: true };
  }

  beforeEach(async () => {
    expectedUlbSetService = { resolve: jest.fn() };
    eligibilityService = { evaluateStateLevelGate: jest.fn(), resolveDevolutionAllocations: jest.fn() };
    lockModel = { find: jest.fn().mockReturnValue(q([])) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterUlbOptionsService,
        { provide: ExpectedUlbSetService, useValue: expectedUlbSetService },
        { provide: ClaimLetterEligibilityService, useValue: eligibilityService },
        { provide: getModelToken(ClaimLetterUlbLock.name), useValue: lockModel },
      ],
    }).compile();

    service = module.get<ClaimLetterUlbOptionsService>(ClaimLetterUlbOptionsService);
  });

  it('throws ForbiddenException for a STATE user requesting a different state', async () => {
    const otherStateUser: AuthUser = { ...stateUser, state: new Types.ObjectId().toString() };
    await expect(service.getOptions(stateId, yearId, 1, {}, otherStateUser)).rejects.toThrow(ForbiddenException);
  });

  it('throws BadRequestException for installment 2', async () => {
    await expect(service.getOptions(stateId, yearId, 2, {}, stateUser)).rejects.toThrow(BadRequestException);
  });

  it('marks every ULB ineligible with the gate failure reason when the state-level gate fails', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA]);
    eligibilityService.evaluateStateLevelGate.mockResolvedValue({
      sources: [{ result: 'FAILED', reasonCode: 'FORM_STATUS_2_NOT_ACCEPTED' } as EligibilityEvaluationResult],
      passed: false,
    });
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());

    const result = await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(result.data![0].eligible).toBe(false);
    expect(result.data![0].ineligibleReasonCode).toBe('FORM_STATUS_2_NOT_ACCEPTED');
  });

  it('marks a ULB ineligible with NO_DEVOLUTION_ALLOCATION when the gate passes but no allocation exists', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA]);
    eligibilityService.evaluateStateLevelGate.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());

    const result = await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(result.data![0].eligible).toBe(false);
    expect(result.data![0].ineligibleReasonCode).toBe('NO_DEVOLUTION_ALLOCATION');
  });

  it('marks a ULB eligible when the gate passes and it has a valid allocation', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA]);
    eligibilityService.evaluateStateLevelGate.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(
      new Map([[ulbA.ulbId, { allocatedAmount: 1, formDocumentId: 'f', rowDocumentId: 'r', datasetVersion: 1 }]]),
    );

    const result = await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(result.data![0]).toMatchObject({ eligible: true, ineligibleReasonCode: null, allocationAmount: 1 });
  });

  it('marks an otherwise-eligible ULB ineligible when locked by a different claim', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA]);
    eligibilityService.evaluateStateLevelGate.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(
      new Map([[ulbA.ulbId, { allocatedAmount: 1, formDocumentId: 'f', rowDocumentId: 'r', datasetVersion: 1 }]]),
    );
    lockModel.find.mockReturnValue(q([{ ulbId: new Types.ObjectId(ulbA.ulbId) }]));

    const result = await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(result.data![0]).toMatchObject({ eligible: false, ineligibleReasonCode: 'ALREADY_LOCKED_IN_ANOTHER_CLAIM' });
  });

  it('excludes the current draft claim from the "locked elsewhere" check via claimLetterId', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA]);
    eligibilityService.evaluateStateLevelGate.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());
    const claimLetterId = new Types.ObjectId().toString();

    await service.getOptions(stateId, yearId, 1, { claimLetterId }, stateUser);

    const [filter] = lockModel.find.mock.calls[0] as [Record<string, unknown>];
    expect((filter['claimLetter'] as { $ne: Types.ObjectId }).$ne.toString()).toBe(claimLetterId);
  });

  it('sorts eligible ULBs before ineligible ones, alphabetically within each group', async () => {
    const ulbC = { ulbId: new Types.ObjectId().toString(), name: 'Charlie ULB', censusCode: '333', sbCode: null };
    expectedUlbSetService.resolve.mockResolvedValue([ulbC, ulbB, ulbA]);
    eligibilityService.evaluateStateLevelGate.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(
      new Map([[ulbB.ulbId, { allocatedAmount: 1, formDocumentId: 'f', rowDocumentId: 'r', datasetVersion: 1 }]]),
    );

    const result = await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(result.data!.map((o) => o.ulbName)).toEqual(['Beta ULB', 'Alpha ULB', 'Charlie ULB']);
  });

  it('filters by search across ULB name and census code', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA, ulbB]);
    eligibilityService.evaluateStateLevelGate.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());

    const result = await service.getOptions(stateId, yearId, 1, { search: 'alpha' }, stateUser);

    expect(result.data).toHaveLength(1);
    expect(result.data![0].ulbName).toBe('Alpha ULB');
  });

  it('filters by search across sbCode too, matching FC Unspent picker behavior', async () => {
    const ulbWithSbCode = {
      ulbId: new Types.ObjectId().toString(),
      name: 'Gamma ULB',
      censusCode: null,
      sbCode: 'SB-99',
    };
    expectedUlbSetService.resolve.mockResolvedValue([ulbA, ulbWithSbCode]);
    eligibilityService.evaluateStateLevelGate.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());

    const result = await service.getOptions(stateId, yearId, 1, { search: 'SB-99' }, stateUser);

    expect(result.data).toHaveLength(1);
    expect(result.data![0].ulbName).toBe('Gamma ULB');
  });

  it('filters by eligibilityFilter=ELIGIBLE / INELIGIBLE', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA, ulbB]);
    eligibilityService.evaluateStateLevelGate.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(
      new Map([[ulbA.ulbId, { allocatedAmount: 1, formDocumentId: 'f', rowDocumentId: 'r', datasetVersion: 1 }]]),
    );

    const eligibleOnly = await service.getOptions(stateId, yearId, 1, { eligibilityFilter: 'ELIGIBLE' }, stateUser);
    expect(eligibleOnly.data!.map((o) => o.ulbId)).toEqual([ulbA.ulbId]);

    const ineligibleOnly = await service.getOptions(stateId, yearId, 1, { eligibilityFilter: 'INELIGIBLE' }, stateUser);
    expect(ineligibleOnly.data!.map((o) => o.ulbId)).toEqual([ulbB.ulbId]);
  });

  it('paginates the combined, sorted, filtered list', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA, ulbB]);
    eligibilityService.evaluateStateLevelGate.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());

    const result = await service.getOptions(stateId, yearId, 1, { page: 1, limit: 1 }, stateUser);

    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({ page: 1, limit: 1, total: 2 });
  });
});
