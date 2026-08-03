import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { ClaimLetterEligibilityService } from './claim-letter-eligibility.service';
import { ClaimEligibilityEvaluatorService } from 'src/module/xvi-fc/common/services/claim-eligibility-evaluator.service';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { RedisService } from 'src/core/services/redis/redis.service';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { ClaimLetterUlbLock } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import { DevolutionFormulaRow } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { EligibilityEvaluationResult } from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import { IFormJson } from 'src/master/form-json/interfaces/form-json.interface';
import { FormJsonService } from 'src/master/form-json/form-json.service';

/** Chainable Mongoose Query-like mock resolving to `value` once `.exec()` is called. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'lean']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('ClaimLetterEligibilityService', () => {
  let service: ClaimLetterEligibilityService;
  let formJsonService: { findEnabledClaimEligibilitySources: jest.Mock };
  let evaluatorService: { evaluate: jest.Mock; evaluateUlbBulk: jest.Mock };
  let expectedUlbSetService: { resolve: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let devolutionFormModel: { findOne: jest.Mock };
  let devolutionRowModel: { find: jest.Mock };
  let batchModel: { find: jest.Mock };
  let batchUlbModel: { aggregate: jest.Mock };
  let ulbLockModel: { find: jest.Mock };

  const stateId = new Types.ObjectId().toString();
  const designYearId = new Types.ObjectId().toString();

  function devolutionSource(overrides: Partial<IFormJson> = {}): IFormJson {
    return {
      _id: new Types.ObjectId(),
      design_year: new Types.ObjectId(designYearId),
      formId: 24,
      type: 'DEVOLUTION_FORMULA',
      isActive: true,
      createdAt: new Date(),
      modifiedAt: new Date(),
      claimEligibility: {
        enabled: true,
        ruleVersion: 1,
        ownerLevel: 'STATE',
        evaluationLevel: 'FORM',
        yearScope: 'CURRENT_DESIGN_YEAR',
        applicableInstallments: [1],
        acceptedFormStatuses: [5, 7],
        source: {
          collection: 'xvifc_devolution_forms',
          fields: { designYear: 'year', state: 'state', currentFormStatus: 'currentFormStatus' },
        },
        evaluator: { type: 'FORM_STATUS' },
        exemption: { allowed: false },
        approval: { action: 'NO_ACTION' },
        rejection: { action: 'NO_ACTION' },
      },
      ...overrides,
    };
  }

  function evaluationResult(overrides: Partial<EligibilityEvaluationResult> = {}): EligibilityEvaluationResult {
    return {
      formId: 24,
      formJsonId: 'x',
      ruleVersion: 1,
      formType: 'DEVOLUTION_FORMULA',
      ownerLevel: 'STATE',
      evaluationLevel: 'FORM',
      formDocumentId: 'form-1',
      statusAtEvaluation: 5,
      result: 'PASSED',
      reasonCode: 'FORM_STATUS_ACCEPTED',
      evidence: {
        evidenceVersion: 1,
        resolvedFormStatus: 5,
        acceptedFormStatuses: [5, 7],
        sourceFormDocumentId: 'form-1',
        evaluatedAt: new Date().toISOString(),
      },
      ...overrides,
    };
  }

  beforeEach(async () => {
    formJsonService = { findEnabledClaimEligibilitySources: jest.fn() };
    evaluatorService = { evaluate: jest.fn(), evaluateUlbBulk: jest.fn() };
    expectedUlbSetService = { resolve: jest.fn().mockResolvedValue([]) };
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() };
    devolutionFormModel = { findOne: jest.fn() };
    devolutionRowModel = { find: jest.fn() };
    batchModel = { find: jest.fn().mockReturnValue(q([])) };
    batchUlbModel = { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) };
    ulbLockModel = { find: jest.fn().mockReturnValue(q([])) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterEligibilityService,
        { provide: FormJsonService, useValue: formJsonService },
        { provide: ClaimEligibilityEvaluatorService, useValue: evaluatorService },
        { provide: ExpectedUlbSetService, useValue: expectedUlbSetService },
        { provide: RedisService, useValue: redis },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test') } },
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: devolutionFormModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: devolutionRowModel },
        { provide: getModelToken(ClaimLetterBatch.name), useValue: batchModel },
        { provide: getModelToken(ClaimLetterBatchUlb.name), useValue: batchUlbModel },
        { provide: getModelToken(ClaimLetterUlbLock.name), useValue: ulbLockModel },
      ],
    }).compile();

    service = module.get<ClaimLetterEligibilityService>(ClaimLetterEligibilityService);
  });

  describe('evaluateStateLevelGate', () => {
    it('evaluates only STATE-owned sources applicable to the requested installment', async () => {
      const stateSource = devolutionSource();
      const ulbSource = devolutionSource({
        claimEligibility: { ...stateSource.claimEligibility!, ownerLevel: 'ULB' },
      });
      const installment2OnlySource = devolutionSource({
        claimEligibility: { ...stateSource.claimEligibility!, applicableInstallments: [2] },
      });
      formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue([
        stateSource,
        ulbSource,
        installment2OnlySource,
      ]);
      evaluatorService.evaluate.mockResolvedValue(evaluationResult());

      await service.evaluateStateLevelGate(stateId, designYearId, 1);

      expect(evaluatorService.evaluate).toHaveBeenCalledTimes(1);
      expect(evaluatorService.evaluate).toHaveBeenCalledWith(stateSource, {
        stateId: new Types.ObjectId(stateId),
        designYearId,
        installment: 1,
      });
    });

    it('passes when every evaluated source is PASSED or EXEMPTED', async () => {
      formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue([devolutionSource()]);
      evaluatorService.evaluate.mockResolvedValue(evaluationResult({ result: 'EXEMPTED' }));

      const gate = await service.evaluateStateLevelGate(stateId, designYearId, 1);

      expect(gate.passed).toBe(true);
    });

    it('fails when any evaluated source is FAILED', async () => {
      formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue([devolutionSource()]);
      evaluatorService.evaluate.mockResolvedValue(evaluationResult({ result: 'FAILED', reasonCode: 'X' }));

      const gate = await service.evaluateStateLevelGate(stateId, designYearId, 1);

      expect(gate.passed).toBe(false);
      expect(gate.sources[0].reasonCode).toBe('X');
    });

    it('passes vacuously with an empty source list', async () => {
      formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue([]);

      const gate = await service.evaluateStateLevelGate(stateId, designYearId, 1);

      expect(gate.passed).toBe(true);
      expect(gate.sources).toEqual([]);
      expect(evaluatorService.evaluate).not.toHaveBeenCalled();
    });
  });

  describe('resolveUlbLevelEligibility', () => {
    const ulbA = new Types.ObjectId().toString();
    const ulbB = new Types.ObjectId().toString();
    const ulbC = new Types.ObjectId().toString();

    function ulbOwnedSource(overrides: Partial<IFormJson> = {}): IFormJson {
      return devolutionSource({
        formId: 32,
        type: 'SLB',
        claimEligibility: {
          ...devolutionSource().claimEligibility!,
          ownerLevel: 'ULB',
          displayLabel: 'SLB',
          displayDescription: 'SLB status must be submitted by the ULB.',
        },
        ...overrides,
      });
    }

    function formAndRowSource(overrides: Partial<IFormJson> = {}): IFormJson {
      return devolutionSource({
        formId: 23,
        type: 'ELECTED_BODY',
        claimEligibility: {
          ...devolutionSource().claimEligibility!,
          ownerLevel: 'STATE',
          evaluationLevel: 'FORM_AND_ROW',
        },
        ...overrides,
      });
    }

    it('filters to ULB-owned and FORM_AND_ROW sources applicable to the installment, ignoring plain STATE/FORM ones', async () => {
      const stateOnly = devolutionSource(); // ownerLevel STATE, evaluationLevel FORM — excluded
      const wrongInstallment = ulbOwnedSource({
        claimEligibility: { ...ulbOwnedSource().claimEligibility!, applicableInstallments: [2] },
      });
      formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue([
        stateOnly,
        ulbOwnedSource(),
        formAndRowSource(),
        wrongInstallment,
      ]);
      evaluatorService.evaluateUlbBulk.mockResolvedValue({
        perUlb: new Map([[ulbA, 'ELIGIBLE']]),
        tally: { eligible: 1, ineligible: 0, exempted: 0, total: 1 },
      });

      await service.resolveUlbLevelEligibility(stateId, designYearId, 1, [ulbA]);

      expect(evaluatorService.evaluateUlbBulk).toHaveBeenCalledTimes(2);
    });

    it('a ULB stays eligible only if it is not INELIGIBLE on any qualifying source', async () => {
      formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue([ulbOwnedSource(), formAndRowSource()]);
      evaluatorService.evaluateUlbBulk
        .mockResolvedValueOnce({
          perUlb: new Map([
            [ulbA, 'ELIGIBLE'],
            [ulbB, 'INELIGIBLE'],
          ]),
          tally: { eligible: 1, ineligible: 1, exempted: 0, total: 2 },
        })
        .mockResolvedValueOnce({
          perUlb: new Map([
            [ulbA, 'EXEMPTED'],
            [ulbB, 'ELIGIBLE'],
          ]),
          tally: { eligible: 1, ineligible: 0, exempted: 1, total: 2 },
        });

      const result = await service.resolveUlbLevelEligibility(stateId, designYearId, 1, [ulbA, ulbB]);

      // ulbA: ELIGIBLE + EXEMPTED -> still eligible overall.
      expect(result.perUlbEligible.get(ulbA)).toBe(true);
      // ulbB: INELIGIBLE on the first source alone is enough to fail overall, despite passing the second.
      expect(result.perUlbEligible.get(ulbB)).toBe(false);
    });

    it('tracks which criterion(s) failed per ULB, falling back to the source type when displayLabel is unset', async () => {
      formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue([ulbOwnedSource(), formAndRowSource()]);
      evaluatorService.evaluateUlbBulk
        .mockResolvedValueOnce({
          // ulbOwnedSource (SLB) — ulbA and ulbC fail this one.
          perUlb: new Map([
            [ulbA, 'INELIGIBLE'],
            [ulbB, 'ELIGIBLE'],
            [ulbC, 'INELIGIBLE'],
          ]),
          tally: { eligible: 1, ineligible: 2, exempted: 0, total: 3 },
        })
        .mockResolvedValueOnce({
          // formAndRowSource (ELECTED_BODY, no displayLabel set) — only ulbB fails this one.
          perUlb: new Map([
            [ulbA, 'ELIGIBLE'],
            [ulbB, 'INELIGIBLE'],
            [ulbC, 'INELIGIBLE'],
          ]),
          tally: { eligible: 1, ineligible: 2, exempted: 0, total: 3 },
        });

      const result = await service.resolveUlbLevelEligibility(stateId, designYearId, 1, [ulbA, ulbB, ulbC]);

      expect(result.perUlbFailedCriteria.get(ulbA)).toEqual(['SLB']);
      expect(result.perUlbFailedCriteria.get(ulbB)).toEqual(['ELECTED_BODY']);
      expect(result.perUlbFailedCriteria.get(ulbC)).toEqual(['SLB', 'ELECTED_BODY']);
    });

    it('routes ownerLevel: ULB sources into standaloneCriteria and FORM_AND_ROW sources into rowTalliesByFormId, keyed by formId', async () => {
      formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue([ulbOwnedSource(), formAndRowSource()]);
      const slbTally = { eligible: 5, ineligible: 2, exempted: 0, total: 7 };
      const eulbTally = { eligible: 10, ineligible: 3, exempted: 1, total: 14 };
      evaluatorService.evaluateUlbBulk
        .mockResolvedValueOnce({ perUlb: new Map(), tally: slbTally })
        .mockResolvedValueOnce({ perUlb: new Map(), tally: eulbTally });

      const result = await service.resolveUlbLevelEligibility(stateId, designYearId, 1, [ulbA]);

      expect(result.standaloneCriteria).toEqual([
        { displayLabel: 'SLB', displayDescription: 'SLB status must be submitted by the ULB.', tally: slbTally },
      ]);
      expect(result.rowTalliesByFormId.get(23)).toEqual(eulbTally);
    });

    it('every expected ULB defaults to eligible when there are no qualifying sources at all', async () => {
      formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue([devolutionSource()]); // STATE/FORM only

      const result = await service.resolveUlbLevelEligibility(stateId, designYearId, 1, [ulbA, ulbB]);

      expect(result.perUlbEligible).toEqual(
        new Map([
          [ulbA, true],
          [ulbB, true],
        ]),
      );
      expect(evaluatorService.evaluateUlbBulk).not.toHaveBeenCalled();
    });
  });

  describe('evaluateStateLevelGateForDisplay', () => {
    it('returns the cached value without recomputing when present in Redis', async () => {
      const cachedGate = { passed: true, sources: [evaluationResult()] };
      redis.get.mockResolvedValue(JSON.stringify(cachedGate));

      const result = await service.evaluateStateLevelGateForDisplay(stateId, designYearId, 1);

      expect(result).toEqual(cachedGate);
      expect(formJsonService.findEnabledClaimEligibilitySources).not.toHaveBeenCalled();
    });

    it('computes and caches the result on a cache miss', async () => {
      redis.get.mockResolvedValue(null);
      formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue([devolutionSource()]);
      evaluatorService.evaluate.mockResolvedValue(evaluationResult());

      const result = await service.evaluateStateLevelGateForDisplay(stateId, designYearId, 1);

      expect(result.passed).toBe(true);
      expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('stateGate'), JSON.stringify(result), 30);
    });
  });

  describe('resolveUlbLevelEligibilityForDisplay', () => {
    const ulbA = new Types.ObjectId().toString();
    const ulbB = new Types.ObjectId().toString();

    it('narrows a cached full-state result to the requested subset without recomputing', async () => {
      const cached = {
        perUlbEligible: [
          [ulbA, true],
          [ulbB, false],
        ],
        standaloneCriteria: [],
        rowTalliesByFormId: [],
        perUlbFailedCriteria: [[ulbB, ['SLB']]],
      };
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.resolveUlbLevelEligibilityForDisplay(stateId, designYearId, 1, [ulbA]);

      expect(result.perUlbEligible).toEqual(new Map([[ulbA, true]]));
      expect(result.perUlbFailedCriteria.size).toBe(0);
      expect(expectedUlbSetService.resolve).not.toHaveBeenCalled();
      expect(formJsonService.findEnabledClaimEligibilitySources).not.toHaveBeenCalled();
    });

    it('computes and caches the FULL expected-ULB-set result on a cache miss, then narrows to the caller-requested subset', async () => {
      redis.get.mockResolvedValue(null);
      expectedUlbSetService.resolve.mockResolvedValue([
        { ulbId: ulbA, name: 'A', censusCode: null, sbCode: null },
        { ulbId: ulbB, name: 'B', censusCode: null, sbCode: null },
      ]);
      const ulbOwnedSource = devolutionSource({
        formId: 32,
        type: 'SLB',
        claimEligibility: { ...devolutionSource().claimEligibility!, ownerLevel: 'ULB' },
      });
      formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue([ulbOwnedSource]);
      evaluatorService.evaluateUlbBulk.mockResolvedValue({
        perUlb: new Map([
          [ulbA, 'ELIGIBLE'],
          [ulbB, 'INELIGIBLE'],
        ]),
        tally: { eligible: 1, ineligible: 1, exempted: 0, total: 2 },
      });

      const result = await service.resolveUlbLevelEligibilityForDisplay(stateId, designYearId, 1, [ulbA]);

      // Computed over the FULL expected set (both ULBs) regardless of the caller only asking about ulbA.
      const [, ctxArg] = evaluatorService.evaluateUlbBulk.mock.calls[0] as [unknown, { expectedUlbIds: string[] }];
      expect(ctxArg.expectedUlbIds).toEqual([ulbA, ulbB]);
      // The returned result is narrowed down to just what this caller asked about.
      expect(result.perUlbEligible).toEqual(new Map([[ulbA, true]]));
      expect(redis.set).toHaveBeenCalled();
    });

    it('uses the caller-supplied fullExpectedUlbIds on a cache miss instead of re-resolving the full set', async () => {
      redis.get.mockResolvedValue(null);
      const ulbOwnedSource = devolutionSource({
        formId: 32,
        type: 'SLB',
        claimEligibility: { ...devolutionSource().claimEligibility!, ownerLevel: 'ULB' },
      });
      formJsonService.findEnabledClaimEligibilitySources.mockResolvedValue([ulbOwnedSource]);
      evaluatorService.evaluateUlbBulk.mockResolvedValue({
        perUlb: new Map([
          [ulbA, 'ELIGIBLE'],
          [ulbB, 'INELIGIBLE'],
        ]),
        tally: { eligible: 1, ineligible: 1, exempted: 0, total: 2 },
      });

      const result = await service.resolveUlbLevelEligibilityForDisplay(
        stateId,
        designYearId,
        1,
        [ulbA],
        [ulbA, ulbB],
      );

      expect(expectedUlbSetService.resolve).not.toHaveBeenCalled();
      const [, ctxArg] = evaluatorService.evaluateUlbBulk.mock.calls[0] as [unknown, { expectedUlbIds: string[] }];
      expect(ctxArg.expectedUlbIds).toEqual([ulbA, ulbB]);
      expect(result.perUlbEligible).toEqual(new Map([[ulbA, true]]));
    });
  });

  describe('resolveDevolutionAllocations', () => {
    it('returns an empty map when no Devolution form exists yet', async () => {
      devolutionFormModel.findOne.mockReturnValue(q(null));

      const result = await service.resolveDevolutionAllocations(stateId, designYearId, 1);

      expect(result.size).toBe(0);
      expect(devolutionRowModel.find).not.toHaveBeenCalled();
    });

    it('bulk-resolves one map entry per active row with a positive installment1Amount', async () => {
      const formId = new Types.ObjectId();
      devolutionFormModel.findOne.mockReturnValue(q({ _id: formId, activeDatasetVersion: 3 }));
      const ulbId = new Types.ObjectId();
      const rowId = new Types.ObjectId();
      devolutionRowModel.find.mockReturnValue(q([{ _id: rowId, ulbId, installment1Amount: 12.5 }]));

      const result = await service.resolveDevolutionAllocations(stateId, designYearId, 1);

      expect(result.get(String(ulbId))).toEqual({
        allocatedAmount: 12.5,
        formDocumentId: String(formId),
        rowDocumentId: String(rowId),
        datasetVersion: 3,
      });
    });

    it('queries rows scoped to the active dataset version, active flag, and positive allocation only', async () => {
      const formId = new Types.ObjectId();
      devolutionFormModel.findOne.mockReturnValue(q({ _id: formId, activeDatasetVersion: 2 }));
      devolutionRowModel.find.mockReturnValue(q([]));

      await service.resolveDevolutionAllocations(stateId, designYearId, 1);

      const [filter] = devolutionRowModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter['form']).toEqual(formId);
      expect(filter['datasetVersion']).toBe(2);
      expect(filter['isActive']).toBe(true);
      expect(filter['installment1Amount']).toEqual({ $gt: 0 });
    });

    it('reads installment2Amount, not installment1Amount, when resolving Installment 2 allocations', async () => {
      const formId = new Types.ObjectId();
      devolutionFormModel.findOne.mockReturnValue(q({ _id: formId, activeDatasetVersion: 1 }));
      const ulbId = new Types.ObjectId();
      const rowId = new Types.ObjectId();
      devolutionRowModel.find.mockReturnValue(q([{ _id: rowId, ulbId, installment2Amount: 7.25 }]));

      const result = await service.resolveDevolutionAllocations(stateId, designYearId, 2);

      const [filter] = devolutionRowModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter['installment2Amount']).toEqual({ $gt: 0 });
      expect(filter['installment1Amount']).toBeUndefined();
      expect(result.get(String(ulbId))?.allocatedAmount).toBe(7.25);
    });
  });

  describe('computeTotalAlreadyAcknowledged', () => {
    it('returns 0 without querying children when no batch has been acknowledged yet', async () => {
      batchModel.find.mockReturnValue(q([]));

      const total = await service.computeTotalAlreadyAcknowledged(stateId, designYearId, 1);

      expect(total).toBe(0);
      expect(batchUlbModel.aggregate).not.toHaveBeenCalled();
    });

    it('sums claimedAmount across every child of the acknowledged parents', async () => {
      const parentId = new Types.ObjectId();
      batchModel.find.mockReturnValue(q([{ _id: parentId }]));
      batchUlbModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ _id: null, total: 42.5 }]) });

      const total = await service.computeTotalAlreadyAcknowledged(stateId, designYearId, 1);

      expect(total).toBe(42.5);
      const [pipeline] = batchUlbModel.aggregate.mock.calls[0] as [Record<string, unknown>[]];
      expect(pipeline[0]).toEqual({ $match: { claimLetter: { $in: [parentId] } } });
    });

    it('scopes the acknowledged-parent lookup to this state/year/installment and the acknowledged status', async () => {
      batchModel.find.mockReturnValue(q([]));

      await service.computeTotalAlreadyAcknowledged(stateId, designYearId, 1);

      const [filter] = batchModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter['state']).toEqual(new Types.ObjectId(stateId));
      expect(filter['year']).toEqual(new Types.ObjectId(designYearId));
      expect(filter['installment']).toBe(1);
      expect(filter['currentFormStatus']).toEqual({ $in: [FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA] });
      expect(filter['isAbandoned']).toBe(false);
      expect(filter['assemblyStatus']).toBe('READY');
      expect(filter['_id']).toBeUndefined();
    });
  });

  describe('computeClaimedAmountByStatuses', () => {
    it('matches on any status in the given list', async () => {
      batchModel.find.mockReturnValue(q([]));

      await service.computeClaimedAmountByStatuses(stateId, designYearId, 1, [
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        FORM_STATUS.IN_PROGRESS,
      ]);

      const [filter] = batchModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter['currentFormStatus']).toEqual({
        $in: [FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.IN_PROGRESS],
      });
    });

    it('excludes the given claim letter id from the matched parents when provided', async () => {
      batchModel.find.mockReturnValue(q([]));
      const excludeId = new Types.ObjectId().toString();

      await service.computeClaimedAmountByStatuses(stateId, designYearId, 1, [FORM_STATUS.IN_PROGRESS], excludeId);

      const [filter] = batchModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter['_id']).toEqual({ $ne: new Types.ObjectId(excludeId) });
    });

    it('omits the _id exclusion filter entirely when no id is given', async () => {
      batchModel.find.mockReturnValue(q([]));

      await service.computeClaimedAmountByStatuses(stateId, designYearId, 1, [FORM_STATUS.IN_PROGRESS]);

      const [filter] = batchModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter['_id']).toBeUndefined();
    });
  });

  describe('getClaimStatusBreakdown', () => {
    it('computes all four fields from one find + one aggregate, bucketed by status', async () => {
      const ackId = new Types.ObjectId();
      const reviewId = new Types.ObjectId();
      const draftId = new Types.ObjectId();
      batchModel.find.mockReturnValue(
        q([
          { _id: ackId, currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA },
          { _id: reviewId, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA },
          { _id: draftId, currentFormStatus: FORM_STATUS.IN_PROGRESS },
        ]),
      );
      batchUlbModel.aggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: ackId, total: 3 },
          { _id: reviewId, total: 4 },
          { _id: draftId, total: 2 },
        ]),
      });

      const breakdown = await service.getClaimStatusBreakdown(stateId, designYearId, 1, 100);

      expect(batchModel.find).toHaveBeenCalledTimes(1);
      expect(batchUlbModel.aggregate).toHaveBeenCalledTimes(1);
      expect(breakdown).toEqual({
        totalAlreadyAcknowledged: 3,
        totalClaimInProgress: 4,
        totalClaimInDraft: 2,
        availableToClaim: 91,
      });
    });

    it('returns all zeros when no batches match any of the three statuses', async () => {
      batchModel.find.mockReturnValue(q([]));

      const breakdown = await service.getClaimStatusBreakdown(stateId, designYearId, 1, 100);

      expect(batchUlbModel.aggregate).not.toHaveBeenCalled();
      expect(breakdown).toEqual({
        totalAlreadyAcknowledged: 0,
        totalClaimInProgress: 0,
        totalClaimInDraft: 0,
        availableToClaim: 100,
      });
    });
  });

  describe('getFinancialOverview', () => {
    it('combines the state-wide allocation pool with the acknowledged/in-progress/draft breakdown', async () => {
      devolutionFormModel.findOne.mockReturnValue(q({ _id: new Types.ObjectId(), activeDatasetVersion: 1 }));
      devolutionRowModel.find.mockReturnValue(
        q([
          { _id: new Types.ObjectId(), ulbId: new Types.ObjectId(), installment1Amount: 10 },
          { _id: new Types.ObjectId(), ulbId: new Types.ObjectId(), installment1Amount: 15 },
        ]),
      );
      const ackId = new Types.ObjectId();
      const reviewId = new Types.ObjectId();
      const draftId = new Types.ObjectId();
      batchModel.find.mockReturnValue(
        q([
          { _id: ackId, currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA },
          { _id: reviewId, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA },
          { _id: draftId, currentFormStatus: FORM_STATUS.IN_PROGRESS },
        ]),
      );
      batchUlbModel.aggregate.mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          { _id: ackId, total: 5 },
          { _id: reviewId, total: 5 },
          { _id: draftId, total: 5 },
        ]),
      });

      const overview = await service.getFinancialOverview(stateId, designYearId, 1);

      expect(overview).toEqual({
        totalInstallmentAllocation: 25,
        totalAlreadyAcknowledged: 5,
        totalClaimInProgress: 5,
        totalClaimInDraft: 5,
        availableToClaim: 10,
      });
    });

    it('returns zeros for a state that has never had a Devolution form or any other claim activity', async () => {
      devolutionFormModel.findOne.mockReturnValue(q(null));
      batchModel.find.mockReturnValue(q([]));

      const overview = await service.getFinancialOverview(stateId, designYearId, 1);

      expect(overview).toEqual({
        totalInstallmentAllocation: 0,
        totalAlreadyAcknowledged: 0,
        totalClaimInProgress: 0,
        totalClaimInDraft: 0,
        availableToClaim: 0,
      });
    });

    it('excludes the given claim letter id from every status bucket when building the overview for a specific batch', async () => {
      devolutionFormModel.findOne.mockReturnValue(q(null));
      batchModel.find.mockReturnValue(q([]));
      const excludeId = new Types.ObjectId().toString();

      await service.getFinancialOverview(stateId, designYearId, 1, excludeId);

      for (const call of batchModel.find.mock.calls) {
        const [filter] = call as [Record<string, unknown>];
        expect(filter['_id']).toEqual({ $ne: new Types.ObjectId(excludeId) });
      }
    });
  });

  describe('resolveClaimedUlbIds', () => {
    it('returns the ULB ids of every ACTIVE/ACKNOWLEDGED lock for this state/year/installment', async () => {
      const ulbA = new Types.ObjectId();
      const ulbB = new Types.ObjectId();
      ulbLockModel.find.mockReturnValue(q([{ ulbId: ulbA }, { ulbId: ulbB }]));

      const result = await service.resolveClaimedUlbIds(stateId, designYearId, 1);

      expect(result).toEqual(new Set([String(ulbA), String(ulbB)]));
      const [filter] = ulbLockModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter['state']).toEqual(new Types.ObjectId(stateId));
      expect(filter['year']).toEqual(new Types.ObjectId(designYearId));
      expect(filter['installment']).toBe(1);
      expect(filter['lockState']).toEqual({ $in: ['ACTIVE', 'ACKNOWLEDGED'] });
      expect(filter['claimLetter']).toBeUndefined();
    });

    it('excludes the given claim letter id when provided', async () => {
      ulbLockModel.find.mockReturnValue(q([]));
      const excludeId = new Types.ObjectId().toString();

      await service.resolveClaimedUlbIds(stateId, designYearId, 1, excludeId);

      const [filter] = ulbLockModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter['claimLetter']).toEqual({ $ne: new Types.ObjectId(excludeId) });
    });
  });

  describe('resolveRemainingUlbIds', () => {
    it('returns expected ULBs that have no ACTIVE/ACKNOWLEDGED lock yet, regardless of eligibility', async () => {
      const claimed = new Types.ObjectId();
      const remaining = new Types.ObjectId();
      ulbLockModel.find.mockReturnValue(q([{ ulbId: claimed }]));

      const result = await service.resolveRemainingUlbIds(stateId, designYearId, 1, [
        String(claimed),
        String(remaining),
      ]);

      expect(result).toEqual([String(remaining)]);
    });

    it("does not exclude any claim letter — a batch's own already-drafted ULBs count as claimed", async () => {
      ulbLockModel.find.mockReturnValue(q([]));

      await service.resolveRemainingUlbIds(stateId, designYearId, 1, []);

      const [filter] = ulbLockModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter['claimLetter']).toBeUndefined();
    });

    it('returns an empty array once every expected ULB is claimed', async () => {
      const ulbA = new Types.ObjectId();
      ulbLockModel.find.mockReturnValue(q([{ ulbId: ulbA }]));

      const result = await service.resolveRemainingUlbIds(stateId, designYearId, 1, [String(ulbA)]);

      expect(result).toEqual([]);
    });
  });
});
