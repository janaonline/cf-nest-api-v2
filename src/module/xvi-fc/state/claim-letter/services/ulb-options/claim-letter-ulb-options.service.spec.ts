import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ClaimLetterUlbOptionsService } from './claim-letter-ulb-options.service';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import type { EligibilityEvaluationResult } from 'src/module/xvi-fc/common/types/claim-eligibility.type';

describe('ClaimLetterUlbOptionsService', () => {
  let service: ClaimLetterUlbOptionsService;
  let expectedUlbSetService: { resolve: jest.Mock };
  let eligibilityService: {
    evaluateStateLevelGateForDisplay: jest.Mock;
    resolveDevolutionAllocations: jest.Mock;
    resolveUlbLevelEligibilityForDisplay: jest.Mock;
    resolveClaimedUlbIds: jest.Mock;
  };

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
    eligibilityService = {
      evaluateStateLevelGateForDisplay: jest.fn(),
      resolveDevolutionAllocations: jest.fn(),
      resolveUlbLevelEligibilityForDisplay: jest
        .fn()
        .mockResolvedValue({ perUlbEligible: new Map(), perUlbFailedCriteria: new Map() }),
      resolveClaimedUlbIds: jest.fn().mockResolvedValue(new Set()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterUlbOptionsService,
        { provide: ExpectedUlbSetService, useValue: expectedUlbSetService },
        { provide: ClaimLetterEligibilityService, useValue: eligibilityService },
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
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue({
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
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());

    const result = await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(result.data![0].eligible).toBe(false);
    expect(result.data![0].ineligibleReasonCode).toBe('NO_DEVOLUTION_ALLOCATION');
  });

  it('marks a ULB eligible when the gate passes and it has a valid allocation', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA]);
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(
      new Map([[ulbA.ulbId, { allocatedAmount: 1, formDocumentId: 'f', rowDocumentId: 'r', datasetVersion: 1 }]]),
    );

    const result = await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(result.data![0]).toMatchObject({ eligible: true, ineligibleReasonCode: null, allocationAmount: 1 });
  });

  it('marks an otherwise-eligible ULB ineligible when locked by a different claim', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA]);
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(
      new Map([[ulbA.ulbId, { allocatedAmount: 1, formDocumentId: 'f', rowDocumentId: 'r', datasetVersion: 1 }]]),
    );
    eligibilityService.resolveClaimedUlbIds.mockResolvedValue(new Set([ulbA.ulbId]));

    const result = await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(result.data![0]).toMatchObject({ eligible: false, ineligibleReasonCode: 'ALREADY_LOCKED_IN_ANOTHER_CLAIM' });
  });

  it('marks an otherwise-eligible ULB ineligible when it fails a new ULB-level criterion (SLB, Annual Accounts, etc.)', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA]);
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(
      new Map([[ulbA.ulbId, { allocatedAmount: 1, formDocumentId: 'f', rowDocumentId: 'r', datasetVersion: 1 }]]),
    );
    eligibilityService.resolveUlbLevelEligibilityForDisplay.mockResolvedValue({
      perUlbEligible: new Map([[ulbA.ulbId, false]]),
      perUlbFailedCriteria: new Map(),
    });

    const result = await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(result.data![0]).toMatchObject({
      eligible: false,
      ineligibleReasonCode: 'ULB_LEVEL_ELIGIBILITY_CRITERIA_NOT_MET',
    });
  });

  it('names the specific failing form(s) in ineligibleReasonDetail when a ULB fails ULB-level criteria', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA]);
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(
      new Map([[ulbA.ulbId, { allocatedAmount: 1, formDocumentId: 'f', rowDocumentId: 'r', datasetVersion: 1 }]]),
    );
    eligibilityService.resolveUlbLevelEligibilityForDisplay.mockResolvedValue({
      perUlbEligible: new Map([[ulbA.ulbId, false]]),
      perUlbFailedCriteria: new Map([[ulbA.ulbId, ['Service Level Benchmarks (SLB)', 'Audited Accounts']]]),
    });

    const result = await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(result.data![0]).toMatchObject({
      eligible: false,
      ineligibleReasonCode: 'ULB_LEVEL_ELIGIBILITY_CRITERIA_NOT_MET',
      ineligibleReasonDetail: 'Service Level Benchmarks (SLB), Audited Accounts eligibility criteria not met',
    });
  });

  it('leaves ineligibleReasonDetail null for non-ULB-level ineligibility reasons', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA]);
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());

    const result = await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(result.data![0]).toMatchObject({
      eligible: false,
      ineligibleReasonCode: 'NO_DEVOLUTION_ALLOCATION',
      ineligibleReasonDetail: null,
    });
  });

  it('passes expectedUlbIds (not a re-derived list) through to resolveUlbLevelEligibilityForDisplay', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA, ulbB]);
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());

    await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(eligibilityService.resolveUlbLevelEligibilityForDisplay).toHaveBeenCalledWith(
      stateId,
      yearId,
      1,
      [ulbA.ulbId, ulbB.ulbId],
      [ulbA.ulbId, ulbB.ulbId],
    );
  });

  it('excludes the current draft claim from the "locked elsewhere" check via claimLetterId', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA]);
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());
    const claimLetterId = new Types.ObjectId().toString();

    await service.getOptions(stateId, yearId, 1, { claimLetterId }, stateUser);

    expect(eligibilityService.resolveClaimedUlbIds).toHaveBeenCalledWith(stateId, yearId, 1, claimLetterId);
  });

  it('sorts eligible ULBs before ineligible ones, alphabetically within each group', async () => {
    const ulbC = { ulbId: new Types.ObjectId().toString(), name: 'Charlie ULB', censusCode: '333', sbCode: null };
    expectedUlbSetService.resolve.mockResolvedValue([ulbC, ulbB, ulbA]);
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(
      new Map([[ulbB.ulbId, { allocatedAmount: 1, formDocumentId: 'f', rowDocumentId: 'r', datasetVersion: 1 }]]),
    );

    const result = await service.getOptions(stateId, yearId, 1, {}, stateUser);

    expect(result.data!.map((o) => o.ulbName)).toEqual(['Beta ULB', 'Alpha ULB', 'Charlie ULB']);
  });

  it('filters by search across ULB name and census code', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA, ulbB]);
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
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
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());

    const result = await service.getOptions(stateId, yearId, 1, { search: 'SB-99' }, stateUser);

    expect(result.data).toHaveLength(1);
    expect(result.data![0].ulbName).toBe('Gamma ULB');
  });

  it('filters by eligibilityFilter=ELIGIBLE / INELIGIBLE', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ulbA, ulbB]);
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
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
    eligibilityService.evaluateStateLevelGateForDisplay.mockResolvedValue(passedGate());
    eligibilityService.resolveDevolutionAllocations.mockResolvedValue(new Map());

    const result = await service.getOptions(stateId, yearId, 1, { page: 1, limit: 1 }, stateUser);

    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({ page: 1, limit: 1, total: 2 });
  });
});
