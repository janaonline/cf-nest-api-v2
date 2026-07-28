import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ClaimLetterEligibilityService } from './claim-letter-eligibility.service';
import { FormJsonService } from 'src/form-json/form-json.service';
import { ClaimEligibilityEvaluatorService } from 'src/module/xvi-fc/common/services/claim-eligibility-evaluator.service';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import { DevolutionFormulaRow } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { IFormJson } from 'src/form-json/interfaces/form-json.interface';
import type { EligibilityEvaluationResult } from 'src/module/xvi-fc/common/types/claim-eligibility.type';

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
  let evaluatorService: { evaluate: jest.Mock };
  let devolutionFormModel: { findOne: jest.Mock };
  let devolutionRowModel: { find: jest.Mock };
  let batchModel: { find: jest.Mock };
  let batchUlbModel: { aggregate: jest.Mock };

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
          collection: 'xvi_fc_devolution_formula_forms',
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
    evaluatorService = { evaluate: jest.fn() };
    devolutionFormModel = { findOne: jest.fn() };
    devolutionRowModel = { find: jest.fn() };
    batchModel = { find: jest.fn().mockReturnValue(q([])) };
    batchUlbModel = { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterEligibilityService,
        { provide: FormJsonService, useValue: formJsonService },
        { provide: ClaimEligibilityEvaluatorService, useValue: evaluatorService },
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: devolutionFormModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: devolutionRowModel },
        { provide: getModelToken(ClaimLetterBatch.name), useValue: batchModel },
        { provide: getModelToken(ClaimLetterBatchUlb.name), useValue: batchUlbModel },
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
    it('computes all four fields from three independent status-scoped sums', async () => {
      // Sequenced per the Promise.all([acknowledged, inProgress, draft]) call order.
      batchModel.find
        .mockReturnValueOnce(q([{ _id: new Types.ObjectId() }])) // acknowledged (status 7)
        .mockReturnValueOnce(q([{ _id: new Types.ObjectId() }])) // in progress (status 5)
        .mockReturnValueOnce(q([{ _id: new Types.ObjectId() }])); // draft (status 2)
      batchUlbModel.aggregate
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ _id: null, total: 3 }]) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ _id: null, total: 4 }]) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue([{ _id: null, total: 2 }]) });

      const breakdown = await service.getClaimStatusBreakdown(stateId, designYearId, 1, 100);

      expect(breakdown).toEqual({
        totalAlreadyAcknowledged: 3,
        totalClaimInProgress: 4,
        totalClaimInDraft: 2,
        availableToClaim: 91,
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
      // Shared mock return value across all three status-scoped calls inside getClaimStatusBreakdown.
      batchModel.find.mockReturnValue(q([{ _id: new Types.ObjectId() }]));
      batchUlbModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ _id: null, total: 5 }]) });

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
});
