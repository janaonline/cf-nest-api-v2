import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ClaimEligibilityEvaluatorService } from './claim-eligibility-evaluator.service';
import type { IFormJson } from 'src/form-json/interfaces/form-json.interface';
import type { ClaimEligibilityConfig } from 'src/module/xvi-fc/common/types/claim-eligibility.type';

describe('ClaimEligibilityEvaluatorService', () => {
  let service: ClaimEligibilityEvaluatorService;
  let findOne: jest.Mock;
  let collection: jest.Mock;
  let connection: { collection: jest.Mock };

  const stateId = new Types.ObjectId();
  const designYearId = new Types.ObjectId().toString();

  const devolutionConfig: ClaimEligibilityConfig = {
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
    evaluator: { type: 'FORM_STATUS', config: { installmentField: 'installment' } },
    exemption: { allowed: false },
    approval: { action: 'NO_ACTION' },
    rejection: { action: 'NO_ACTION' },
  };

  function sourceFormJson(overrides: Partial<IFormJson> = {}): IFormJson {
    return {
      _id: new Types.ObjectId(),
      design_year: new Types.ObjectId(designYearId),
      formId: 24,
      type: 'DEVOLUTION_FORMULA',
      isActive: true,
      createdAt: new Date(),
      modifiedAt: new Date(),
      claimEligibility: devolutionConfig,
      ...overrides,
    };
  }

  beforeEach(async () => {
    findOne = jest.fn();
    collection = jest.fn().mockReturnValue({ findOne });
    connection = { collection };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ClaimEligibilityEvaluatorService, { provide: getConnectionToken(), useValue: connection }],
    }).compile();

    service = module.get<ClaimEligibilityEvaluatorService>(ClaimEligibilityEvaluatorService);
  });

  it('throws when the formJson has no enabled claimEligibility config', async () => {
    const doc = sourceFormJson({ claimEligibility: null });
    await expect(service.evaluate(doc, { stateId, designYearId, installment: 1 })).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('throws for an unsupported evaluator.type rather than silently passing', async () => {
    const doc = sourceFormJson({
      claimEligibility: { ...devolutionConfig, evaluator: { type: 'ONE_TIME_FORM_STATUS' } },
    });
    await expect(service.evaluate(doc, { stateId, designYearId, installment: 1 })).rejects.toThrow(
      /Unsupported claim-eligibility evaluator type/,
    );
  });

  it('queries the configured collection scoped by design year, state, and installment', async () => {
    findOne.mockResolvedValue({ _id: new Types.ObjectId(), currentFormStatus: 5 });

    await service.evaluate(sourceFormJson(), { stateId, designYearId, installment: 1 });

    expect(collection).toHaveBeenCalledWith('xvi_fc_devolution_formula_forms');
    const [query] = findOne.mock.calls[0] as [Record<string, unknown>];
    expect((query['year'] as Types.ObjectId).toString()).toBe(designYearId);
    expect(query['state']).toBe(stateId);
    expect(query['installment']).toBe(1);
  });

  it('returns PASSED when the resolved form status is in acceptedFormStatuses', async () => {
    const formDocId = new Types.ObjectId();
    findOne.mockResolvedValue({ _id: formDocId, currentFormStatus: 5 });

    const result = await service.evaluate(sourceFormJson(), { stateId, designYearId, installment: 1 });

    expect(result.result).toBe('PASSED');
    expect(result.statusAtEvaluation).toBe(5);
    expect(result.formDocumentId).toBe(String(formDocId));
    expect(result.evidence).toMatchObject({
      evidenceVersion: 1,
      resolvedFormStatus: 5,
      sourceFormDocumentId: String(formDocId),
    });
  });

  it('returns FAILED when the resolved form status is not in acceptedFormStatuses', async () => {
    findOne.mockResolvedValue({ _id: new Types.ObjectId(), currentFormStatus: 2 });

    const result = await service.evaluate(sourceFormJson(), { stateId, designYearId, installment: 1 });

    expect(result.result).toBe('FAILED');
    expect(result.reasonCode).toBe('FORM_STATUS_2_NOT_ACCEPTED');
  });

  it('returns FAILED with null identity fields when no source document exists yet', async () => {
    findOne.mockResolvedValue(null);

    const result = await service.evaluate(sourceFormJson(), { stateId, designYearId, installment: 1 });

    expect(result.result).toBe('FAILED');
    expect(result.reasonCode).toBe('SOURCE_FORM_NOT_FOUND');
    expect(result.formDocumentId).toBeNull();
    expect(result.statusAtEvaluation).toBeNull();
    expect(result.evidence).toMatchObject({ resolvedFormStatus: null, sourceFormDocumentId: null });
  });

  it('never branches on a hardcoded formId anywhere in its evaluation logic', () => {
    // Structural guard against reintroducing `if (formId === 24)`-style special-casing (brain
    // §3.1) — the evaluator must stay driven entirely by the passed-in config.
    const serviceSource = ClaimEligibilityEvaluatorService.toString();
    expect(serviceSource).not.toMatch(/formId\s*===\s*24/);
  });
});
