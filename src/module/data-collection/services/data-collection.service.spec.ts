import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { ApiClientContext } from 'src/module/auth/types/api-client-context.type';
import { Ulb } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';
import { DataCollection } from '../entities/data-collection.schema';
import type { DataCollectionValidationIssue } from '../types';
import { DataCollectionAuthorizationService } from './data-collection-authorization.service';
import { DataCollectionService } from './data-collection.service';
import { LineItemsLegendService } from 'src/module/line-items-legends/line-items-legend.service';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const makeLegend = (nmamCode: string, rules = []) => ({
  nmamCode,
  name: `Legend ${nmamCode}`,
  accountHead: 'INCOME',
  level: 1,
  parentCode: null,
  rules,
});

const validUlbId = '5dd24729437ba31f7eb42eee';
const validYearId = '606aafb14dff55e6c075d3ae';

const stateClient: ApiClientContext = {
  apiClientId: 'aId',
  clientId: 'c1',
  actorType: 'STATE',
  stateId: '5dcf9d7216a06aed41c748dd',
  scopes: [],
};

// ─── Mock factories ────────────────────────────────────────────────────────────

let mockSave: jest.Mock;

/** Returns a jest constructor mock that supports `new Model(data)` and static `findOne`. */
const mockDataCollectionModel = () => {
  mockSave = jest.fn().mockResolvedValue({ _id: 'doc1', templateVersion: '2026.1', lineItems: new Map() });
  const Ctor = jest.fn().mockImplementation((data: object) => ({ ...data, save: mockSave })) as jest.Mock & {
    findOne: jest.Mock;
  };
  Ctor.findOne = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
  return Ctor;
};

const mockUlbModel = { find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) };
const mockYearModel = { find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) };

const mockAuthorizationService = {
  validateCanSubmitForUlb: jest.fn().mockResolvedValue(undefined),
  validateCanModifyForUlb: jest.fn().mockResolvedValue(undefined),
  getAllowedUlbFilter: jest.fn().mockReturnValue({ isActive: true }),
};

const mockTemplateResult = {
  templateVersion: '2026.1',
  accountHeads: ['INCOME', 'EXPENDITURE'],
  lineItems: [{ nmamCode: '110', name: 'Tax Revenue' }],
  codes: ['110'],
};

const mockLineItemsLegendService = {
  getFinancialDataTemplate: jest.fn().mockResolvedValue(mockTemplateResult),
  getActiveLegendsForValidation: jest.fn().mockResolvedValue([]),
};

// ─── Test suite ────────────────────────────────────────────────────────────────

describe('DataCollectionService', () => {
  let service: DataCollectionService;
  let dcModel: ReturnType<typeof mockDataCollectionModel>;

  beforeEach(async () => {
    dcModel = mockDataCollectionModel();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataCollectionService,
        { provide: getModelToken(DataCollection.name), useValue: dcModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: getModelToken(Year.name), useValue: mockYearModel },
        { provide: DataCollectionAuthorizationService, useValue: mockAuthorizationService },
        { provide: LineItemsLegendService, useValue: mockLineItemsLegendService },
      ],
    }).compile();

    service = module.get<DataCollectionService>(DataCollectionService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  // ─── getFinancialDataTemplate ──────────────────────────────────────────────

  describe('getFinancialDataTemplate', () => {
    it('delegates to LineItemsLegendService and returns templateVersion/accountHeads/lineItems/codes', async () => {
      const result = await service.getFinancialDataTemplate();
      expect(mockLineItemsLegendService.getFinancialDataTemplate).toHaveBeenCalled();
      expect(result).toHaveProperty('templateVersion');
      expect(result).toHaveProperty('accountHeads');
      expect(result).toHaveProperty('lineItems');
      expect(result).toHaveProperty('codes');
    });

    it('passes query params to LineItemsLegendService', async () => {
      const query = { templateVersion: '2026.1', accountHead: 'INCOME' as const };
      await service.getFinancialDataTemplate(query);
      expect(mockLineItemsLegendService.getFinancialDataTemplate).toHaveBeenCalledWith(query);
    });

    it('does not use hardcoded constant lineItems for template', async () => {
      await service.getFinancialDataTemplate();
      expect(mockLineItemsLegendService.getFinancialDataTemplate).toHaveBeenCalledTimes(1);
    });
  });

  // ─── getUlbsList ──────────────────────────────────────────────────────────

  describe('getUlbsList', () => {
    it('uses authorizationService filter instead of hardcoded AP_ID', async () => {
      await service.getUlbsList(stateClient);
      expect(mockAuthorizationService.getAllowedUlbFilter).toHaveBeenCalledWith(stateClient);
    });

    it('hardcoded AP_ID is removed', async () => {
      await service.getUlbsList(stateClient);
      const findArg = (mockUlbModel.find.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(JSON.stringify(findArg)).not.toContain('5dcf9d7216a06aed41c748dd');
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    const basePayload = { ulbId: validUlbId, yearId: validYearId, lineItems: {} };

    it('calls ownership validation before DB write', async () => {
      await service.create(basePayload as never, stateClient).catch(() => {});
      expect(mockAuthorizationService.validateCanSubmitForUlb).toHaveBeenCalledWith(stateClient, basePayload.ulbId);
    });

    it('throws ConflictException when data already exists', async () => {
      dcModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'existing' }) });
      await expect(service.create(basePayload as never, stateClient)).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when authorization fails', async () => {
      mockAuthorizationService.validateCanSubmitForUlb.mockRejectedValueOnce(
        new ForbiddenException('Client is not allowed to access this ULB.'),
      );
      await expect(service.create(basePayload as never, stateClient)).rejects.toThrow(ForbiddenException);
    });

    it('rejects unknown nmamCode with a clear error', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '999999': 100 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].lineItemCode).toBe('999999');
      expect(body.errors[0].message).toContain('does not exist in template version');
    });

    it('does not use hardcoded constant for key validation', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('CUSTOM_NEW')]);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { CUSTOM_NEW: 500 } };

      await service.create(payload as never, stateClient).catch(() => {});
      expect(mockLineItemsLegendService.getActiveLegendsForValidation).toHaveBeenCalled();
    });

    it('accepts 0 as a valid value', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 0 } };

      await service.create(payload as never, stateClient).catch(() => {});
      expect(dcModel).toHaveBeenCalledWith(expect.objectContaining({ templateVersion: '2026.1' }));
    });

    it('rejects null value', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': null } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors.some((e) => e.lineItemCode === '110')).toBe(true);
    });

    it('rejects string value', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 'not-a-number' } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('must be a finite number');
    });

    it('validates a correct formula sum when all operands are submitted', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002'] };
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 900, '11001': 500, '11002': 400 } };

      await service.create(payload as never, stateClient);
      expect(dcModel).toHaveBeenCalledWith(expect.objectContaining({ templateVersion: '2026.1' }));
    });

    it('rejects a formula sum mismatch when all operands are submitted', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002'] };
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 999, '11001': 500, '11002': 400 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('must equal sum of submitted operands');
      expect(body.errors[0].message).toContain('Expected: 900');
    });

    it('sparse: parent matches sum of the subset of operands that were submitted', async () => {
      // operands list includes 11001–11003 but only 11010 and 11006 are submitted
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002', '11003', '11010', '11006'] };
      const legends = [
        makeLegend('11001'),
        makeLegend('11002'),
        makeLegend('11003'),
        makeLegend('11010'),
        makeLegend('11006'),
        makeLegend('110', [sumRule] as never),
      ];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = {
        ulbId: validUlbId,
        yearId: validYearId,
        lineItems: { '110': 1300, '11010': 1000, '11006': 300 },
      };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect(result['validationStatus']).toBe('VALID');
    });

    it('sparse: rejects when parent does not match sum of submitted operands', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002', '11003', '11010', '11006'] };
      const legends = [
        makeLegend('11001'),
        makeLegend('11002'),
        makeLegend('11003'),
        makeLegend('11010'),
        makeLegend('11006'),
        makeLegend('110', [sumRule] as never),
      ];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = {
        ulbId: validUlbId,
        yearId: validYearId,
        lineItems: { '110': 1300, '11010': 1000, '11006': 200 },
      };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('must equal sum of submitted operands 11010, 11006');
      expect(body.errors[0].message).toContain('Expected: 1200');
      expect(body.errors[0].message).toContain('Received: 1300');
    });

    it('fails when parent is submitted but none of its operands are', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002'] };
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 1300 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('cannot be validated because none of its operands were submitted');
    });

    it('passes when only operand children are submitted without the parent', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002'] };
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      // parent 110 absent — formula validation is skipped entirely
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '11001': 500, '11002': 400 } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect(result['validationStatus']).toBe('VALID');
    });

    it('fails when a formula rule references an operand not in the template', async () => {
      // GHOST is in the formula operands but not in legendMap
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', 'GHOST'] };
      const legends = [makeLegend('11001'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 500, '11001': 500 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('refers to unknown operand GHOST');
    });

    it('explicit 0 counts as a submitted operand and validates the formula', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002'] };
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 0, '11001': 0, '11002': 0 } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['validationStatus']).toBe('VALID');
    });

    it('saves with VALID validationStatus and does not save invalid data', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 500 } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect(result['validationStatus']).toBe('VALID');
      expect(dcModel).toHaveBeenCalledWith(expect.objectContaining({ validationStatus: 'VALID' }));
    });

    it('saves sparse lineItems exactly as submitted without padding missing keys', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002', '11003'] };
      const legends = [
        makeLegend('11001'),
        makeLegend('11002'),
        makeLegend('11003'),
        makeLegend('110', [sumRule] as never),
      ];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      // 11003 not submitted — sparse; parent matches submitted sum (500+400=900)
      const lineItems = { '110': 900, '11001': 500, '11002': 400 };
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems };

      await service.create(payload as never, stateClient);
      // Only submitted keys saved — no phantom '11003' key
      expect(dcModel).toHaveBeenCalledWith(expect.objectContaining({ lineItems }));
    });

    it('saves templateVersion on the document', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbId: validUlbId, yearId: validYearId, templateVersion: '2026.1', lineItems: { '110': 500 } };

      await service.create(payload as never, stateClient);
      expect(dcModel).toHaveBeenCalledWith(expect.objectContaining({ templateVersion: '2026.1' }));
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    const basePayload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 500 } };

    it('calls ownership validation before DB write', async () => {
      dcModel.findOne.mockReturnValue({ lineItems: new Map(), save: jest.fn().mockResolvedValue({}) });
      await service.update(basePayload as never, stateClient).catch(() => {});
      expect(mockAuthorizationService.validateCanModifyForUlb).toHaveBeenCalledWith(stateClient, basePayload.ulbId);
    });

    it('throws NotFoundException when data does not exist', async () => {
      dcModel.findOne.mockReturnValue(null);
      await expect(service.update(basePayload as never, stateClient)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when authorization fails', async () => {
      mockAuthorizationService.validateCanModifyForUlb.mockRejectedValueOnce(
        new ForbiddenException('Client is not allowed to access this ULB.'),
      );
      await expect(service.update(basePayload as never, stateClient)).rejects.toThrow(ForbiddenException);
    });

    it('merges existing and incoming line items', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        lineItems: new Map<string, number>([['11001', 600]]),
        save: jest.fn().mockResolvedValue({}),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      const legends = [makeLegend('110'), makeLegend('11001'), makeLegend('11002')];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);

      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 1000, '11002': 400 } };
      await service.update(payload as never, stateClient).catch(() => {});

      const savedMap = existingDoc.lineItems as unknown as Map<string, unknown>;
      expect(savedMap.has('11001')).toBe(true);
    });

    it('validates merged data against DB legends', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        lineItems: new Map<string, number>([['110', 1000]]),
        save: jest.fn(),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([]);

      const err = await service.update(basePayload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
    });

    it('rejects changing templateVersion for an existing record', async () => {
      dcModel.findOne.mockReturnValue({ templateVersion: '2026.1', lineItems: new Map(), save: jest.fn() });

      const payload = { ulbId: validUlbId, yearId: validYearId, templateVersion: '2027.1', lineItems: { '110': 500 } };
      await expect(service.update(payload as never, stateClient)).rejects.toThrow(BadRequestException);
    });

    it('does not silently ignore null in incoming line items', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        lineItems: new Map<string, number>([['110', 1000]]),
        save: jest.fn(),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);

      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': null } };
      const err = await service.update(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors.some((e) => e.lineItemCode === '110')).toBe(true);
    });

    it('stamps templateVersion on existing documents that lack it', async () => {
      const existingDoc = {
        templateVersion: undefined as unknown as string,
        lineItems: new Map<string, number>([['110', 500]]),
        save: jest.fn().mockResolvedValue({}),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);

      await service.update({ ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 500 } } as never, stateClient);
      expect(existingDoc.templateVersion).toBe('2026.1');
    });

    it('validates merged sparse data — parent must match submitted operand sum after merge', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002', '11003'] };
      // existing has 11001=600; patch submits 110=1600 and 11002=1000
      const existingDoc = {
        templateVersion: '2026.1',
        lineItems: new Map<string, number>([['11001', 600]]),
        save: jest.fn().mockResolvedValue({}),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([
        makeLegend('11001'),
        makeLegend('11002'),
        makeLegend('11003'),
        makeLegend('110', [sumRule] as never),
      ]);

      // merged: {11001: 600, 110: 1600, 11002: 1000} — submitted operands 11001+11002 = 1600 === 1600
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 1600, '11002': 1000 } };
      const result = (await service.update(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect(result['validationStatus']).toBe('VALID');
    });

    it('rejects merged data when parent does not match submitted operand sum after merge', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002'] };
      const existingDoc = {
        templateVersion: '2026.1',
        lineItems: new Map<string, number>([['11001', 600]]),
        save: jest.fn(),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([
        makeLegend('11001'),
        makeLegend('11002'),
        makeLegend('110', [sumRule] as never),
      ]);

      // merged: {11001: 600, 110: 1300, 11002: 500} — submitted sum 600+500=1100 !== 1300
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 1300, '11002': 500 } };
      const err = await service.update(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('must equal sum of submitted operands');
      expect(body.errors[0].message).toContain('Expected: 1100');
    });
  });

  // ─── rule metadata in validation errors ───────────────────────────────────

  describe('rule metadata in validation errors', () => {
    const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002'] };

    it('formula mismatch error includes validationRule, submittedOperands, expected, received', async () => {
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 999, '11001': 500, '11002': 400 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors[0];

      expect(issue.validationRule).toMatchObject({ type: 'formula', operation: 'sum', operands: ['11001', '11002'] });
      expect(issue.submittedOperands).toEqual(['11001', '11002']);
      expect(issue.expected).toBe(900);
      expect(issue.received).toBe(999);
    });

    it('formula mismatch error still contains lineItemCode, value, severity, message', async () => {
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 999, '11001': 500, '11002': 400 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors[0];

      expect(issue.lineItemCode).toBe('110');
      expect(issue.value).toBe(999);
      expect(issue.severity).toBe('ERROR');
      expect(issue.message).toContain('must equal sum of submitted operands');
    });

    it('sparse mismatch includes only the submitted subset in submittedOperands', async () => {
      // full operands list is 11001–11003 but only 11001 and 11003 are submitted
      const sparseRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002', '11003'] };
      const legends = [
        makeLegend('11001'),
        makeLegend('11002'),
        makeLegend('11003'),
        makeLegend('110', [sparseRule] as never),
      ];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 999, '11001': 500, '11003': 400 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors[0];

      expect(issue.submittedOperands).toEqual(['11001', '11003']);
      expect(issue.expected).toBe(900);
      expect(issue.validationRule).toMatchObject({ operands: ['11001', '11002', '11003'] });
    });

    it('no submitted operands error includes validationRule, submittedOperands [], expected null, received', async () => {
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 1300 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors[0];

      expect(issue.validationRule).toMatchObject({ type: 'formula', operation: 'sum' });
      expect(issue.submittedOperands).toEqual([]);
      expect(issue.expected).toBeNull();
      expect(issue.received).toBe(1300);
    });

    it('template integrity error includes validationRule, submittedOperands so far, expected null', async () => {
      // 11001 is valid and submitted; GHOST is unknown in template
      const ruleWithGhost = { type: 'formula', operation: 'sum', operands: ['11001', 'GHOST'] };
      const legends = [makeLegend('11001'), makeLegend('110', [ruleWithGhost] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 500, '11001': 500 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors[0];

      expect(issue.validationRule).toMatchObject({ operands: ['11001', 'GHOST'] });
      expect(issue.expected).toBeNull();
      expect(issue.received).toBe(500);
    });

    it('unknown code error does not include validationRule', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '999999': 100 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };

      expect(body.errors[0]).not.toHaveProperty('validationRule');
    });

    it('invalid value error does not include validationRule', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': 'bad' } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };

      expect(body.errors[0]).not.toHaveProperty('validationRule');
    });

    it('null value error does not include validationRule', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbId: validUlbId, yearId: validYearId, lineItems: { '110': null } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };

      expect(body.errors[0]).not.toHaveProperty('validationRule');
    });
  });
});
