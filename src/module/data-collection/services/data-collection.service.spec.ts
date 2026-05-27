import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { User } from 'src/module/auth/enum/role.enum';
import type { ApiClientContext } from 'src/module/auth/types/api-client-context.type';
import { LineItemsLegendService } from 'src/module/line-items-legends/line-items-legend.service';
import { Ulb } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';
import { DataCollection } from '../entities/data-collection.schema';
import type { DataCollectionValidationIssue } from '../types/data-collection.types';
import { DataCollectionAuditLogService } from './data-collection-audit-log.service';
import { DataCollectionAuthorizationService } from './data-collection-authorization.service';
import { DataCollectionReferenceResolverService } from './data-collection-reference-resolver.service';
import { DataCollectionService } from './data-collection.service';

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
const validStateId = '5dcf9d7216a06aed41c748dd';
const validYearId = '606aafb14dff55e6c075d3ae';
const validApiClientId = new Types.ObjectId().toString();
const validAdminId = new Types.ObjectId().toString();
const validUlbCode = 'C001';
const validYearCode = '2021-22';

const stateClient: ApiClientContext = {
  apiClientId: validApiClientId,
  clientId: 'c1',
  actorType: 'STATE',
  stateId: validStateId,
  scopes: [],
};

const adminUser: User = {
  _id: validAdminId,
  email: 'admin@example.com',
  role: 'ADMIN' as User['role'],
  ulb: '',
  state: '',
};

const removedAuditFields = ['clientId', 'actorType', 'ulbCode', 'yearCode', 'submittedLineItemCodes', 'warningCount'];

// ─── Mock factories ────────────────────────────────────────────────────────────

const mockDate = new Date('2024-01-01T00:00:00.000Z');

/** Builds a minimal saved document returned by Mongoose save(). */
const makeDocSaveResult = (
  overrides: Partial<{ templateVersion: string; validationStatus: string; lineItems: Map<string, number> }> = {},
) => ({
  templateVersion: overrides.templateVersion ?? '2026.1',
  validationStatus: overrides.validationStatus ?? 'VALID',
  lineItems: overrides.lineItems ?? new Map<string, number>(),
  createdAt: mockDate,
  updatedAt: mockDate,
});

let mockSave: jest.Mock;

/** Returns a jest constructor mock that supports `new Model(data)` and static `findOne`. */
const mockDataCollectionModel = () => {
  mockSave = jest.fn().mockResolvedValue(makeDocSaveResult());
  const Ctor = jest.fn().mockImplementation((data: object) => ({ ...data, save: mockSave })) as jest.Mock & {
    findOne: jest.Mock;
  };
  Ctor.findOne = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
  return Ctor;
};

/** Builds a chainable ULB query mock that supports .select().populate().lean(). */
const makeUlbChain = (leanResult: unknown[] = []) => ({
  select: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(leanResult),
});

let defaultUlbChain: ReturnType<typeof makeUlbChain>;
const mockUlbModel = { find: jest.fn() };

const mockYearModel = { find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) };

const mockAuthorizationService = {
  validateCanSubmitForUlb: jest.fn().mockResolvedValue(undefined),
  validateCanModifyForUlb: jest.fn().mockResolvedValue(undefined),
  getAllowedUlbFilter: jest.fn().mockReturnValue({ isActive: true }),
};

const mockReferenceResolverService = {
  resolveUlbByCode: jest
    .fn()
    .mockResolvedValue({ ulbId: new Types.ObjectId(validUlbId), stateId: new Types.ObjectId(validStateId) }),
  resolveYearByCode: jest.fn().mockResolvedValue({ yearId: new Types.ObjectId(validYearId), yearCode: validYearCode }),
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

const mockAuditLogService = {
  logSubmitted: jest.fn().mockResolvedValue(undefined),
  logModified: jest.fn().mockResolvedValue(undefined),
  logValidationFailed: jest.fn().mockResolvedValue(undefined),
  logDuplicateSubmit: jest.fn().mockResolvedValue(undefined),
  logModifyNotFound: jest.fn().mockResolvedValue(undefined),
  logReversed: jest.fn().mockResolvedValue(undefined),
};

const expectNoRemovedAuditFields = (arg: Record<string, unknown>) => {
  for (const field of removedAuditFields) {
    expect(arg).not.toHaveProperty(field);
  }
};

// ─── Test suite ────────────────────────────────────────────────────────────────

describe('DataCollectionService', () => {
  let service: DataCollectionService;
  let dcModel: ReturnType<typeof mockDataCollectionModel>;

  beforeEach(async () => {
    dcModel = mockDataCollectionModel();
    defaultUlbChain = makeUlbChain();
    jest.clearAllMocks();
    mockUlbModel.find.mockReturnValue(defaultUlbChain);
    mockYearModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    mockReferenceResolverService.resolveUlbByCode.mockResolvedValue({
      ulbId: new Types.ObjectId(validUlbId),
      stateId: new Types.ObjectId(validStateId),
    });
    mockReferenceResolverService.resolveYearByCode.mockResolvedValue({
      yearId: new Types.ObjectId(validYearId),
      yearCode: validYearCode,
    });
    mockAuditLogService.logSubmitted.mockResolvedValue(undefined);
    mockAuditLogService.logModified.mockResolvedValue(undefined);
    mockAuditLogService.logValidationFailed.mockResolvedValue(undefined);
    mockAuditLogService.logDuplicateSubmit.mockResolvedValue(undefined);
    mockAuditLogService.logModifyNotFound.mockResolvedValue(undefined);
    mockAuditLogService.logReversed.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataCollectionService,
        { provide: getModelToken(DataCollection.name), useValue: dcModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: getModelToken(Year.name), useValue: mockYearModel },
        { provide: DataCollectionAuthorizationService, useValue: mockAuthorizationService },
        { provide: LineItemsLegendService, useValue: mockLineItemsLegendService },
        { provide: DataCollectionReferenceResolverService, useValue: mockReferenceResolverService },
        { provide: DataCollectionAuditLogService, useValue: mockAuditLogService },
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

    it('returns { code, name, state } shape', async () => {
      const ulbData = [
        { censusCode: 'C001', sbCode: 'S001', name: 'TestCity', state: { code: 'AP', name: 'Andhra Pradesh' } },
      ];
      mockUlbModel.find.mockReturnValueOnce(makeUlbChain(ulbData));
      const result = await service.getUlbsList(stateClient);
      expect(result).toEqual([{ code: 'C001', name: 'TestCity', state: { code: 'AP', name: 'Andhra Pradesh' } }]);
    });

    it('uses sbCode as fallback when censusCode is null', async () => {
      const ulbData = [
        { censusCode: null, sbCode: 'S001', name: 'TestCity', state: { code: 'AP', name: 'Andhra Pradesh' } },
      ];
      mockUlbModel.find.mockReturnValueOnce(makeUlbChain(ulbData));
      const result = await service.getUlbsList(stateClient);
      expect(result).toEqual([{ code: 'S001', name: 'TestCity', state: { code: 'AP', name: 'Andhra Pradesh' } }]);
    });

    it('skips ULBs where both censusCode and sbCode are null', async () => {
      const ulbData = [
        { censusCode: 'C001', sbCode: null, name: 'Good', state: { code: 'AP', name: 'AP State' } },
        { censusCode: null, sbCode: null, name: 'NoCode', state: { code: 'AP', name: 'AP State' } },
      ];
      mockUlbModel.find.mockReturnValueOnce(makeUlbChain(ulbData));
      const result = await service.getUlbsList(stateClient);
      expect(result).toHaveLength(1);
      expect((result as { name: string }[])[0].name).toBe('Good');
    });

    it('does not return _id in response', async () => {
      const ulbData = [
        {
          _id: 'should-be-hidden',
          censusCode: 'C001',
          sbCode: null,
          name: 'City',
          state: { code: 'AP', name: 'AP State' },
        },
      ];

      mockUlbModel.find.mockReturnValueOnce(makeUlbChain(ulbData));

      const result = (await service.getUlbsList(stateClient)) as Record<string, unknown>[];

      expect(result[0]).not.toHaveProperty('_id');
    });

    it('does not return censusCode or sbCode in response', async () => {
      const ulbData = [{ censusCode: 'C001', sbCode: 'S001', name: 'City', state: { code: 'AP', name: 'AP State' } }];
      mockUlbModel.find.mockReturnValueOnce(makeUlbChain(ulbData));
      const result = await service.getUlbsList(stateClient);
      const item = (result as Record<string, unknown>[])[0];
      expect(item).not.toHaveProperty('censusCode');
      expect(item).not.toHaveProperty('sbCode');
    });

    it('does not return stateId in response', async () => {
      const ulbData = [{ censusCode: 'C001', sbCode: null, name: 'City', state: { code: 'AP', name: 'AP State' } }];
      mockUlbModel.find.mockReturnValueOnce(makeUlbChain(ulbData));
      const result = await service.getUlbsList(stateClient);
      const item = (result as Record<string, unknown>[])[0];
      expect(item).not.toHaveProperty('stateId');
    });

    it('populates state via populate, not a raw ObjectId', async () => {
      await service.getUlbsList(stateClient);
      expect(defaultUlbChain.populate).toHaveBeenCalledWith(expect.objectContaining({ path: 'state' }));
    });

    it('excludes _id from select projection', async () => {
      await service.getUlbsList(stateClient);
      const selectArg = (defaultUlbChain.select.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(selectArg).toMatchObject({ _id: 0 });
    });

    it('does not make one DB call per ULB — single find+populate', async () => {
      const ulbData = [
        { censusCode: 'C001', sbCode: null, name: 'City1', state: { code: 'AP', name: 'AP State' } },
        { censusCode: 'C002', sbCode: null, name: 'City2', state: { code: 'AP', name: 'AP State' } },
        { censusCode: 'C003', sbCode: null, name: 'City3', state: { code: 'AP', name: 'AP State' } },
      ];
      mockUlbModel.find.mockReturnValueOnce(makeUlbChain(ulbData));
      await service.getUlbsList(stateClient);
      expect(mockUlbModel.find).toHaveBeenCalledTimes(1);
    });

    it('returns undefined state when state populate returns null', async () => {
      const ulbData = [{ censusCode: 'C001', sbCode: null, name: 'City', state: null }];
      mockUlbModel.find.mockReturnValueOnce(makeUlbChain(ulbData));
      const result = await service.getUlbsList(stateClient);
      const item = (result as Record<string, unknown>[])[0];
      expect(item['state']).toBeUndefined();
    });
  });

  // ─── getYearsList ─────────────────────────────────────────────────────────

  describe('getYearsList', () => {
    it('returns { yearCode, displayName } shape without _id', async () => {
      mockYearModel.find.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([{ year: '2021-22' }]) });
      const result = await service.getYearsList();
      expect(result).toEqual([{ yearCode: '2021-22', displayName: '2021-22' }]);
    });

    it('excludes _id from the DB projection', async () => {
      await service.getYearsList();
      const projectionArg = (mockYearModel.find.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect(projectionArg).toMatchObject({ _id: 0 });
    });

    it('only queries active years', async () => {
      await service.getYearsList();
      const filterArg = (mockYearModel.find.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(filterArg).toEqual({ isActive: true });
    });

    it('sorts years latest first', async () => {
      const years = [{ year: '2024-25' }, { year: '2026-27' }, { year: '2025-26' }];
      mockYearModel.find.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(years) });
      const result = await service.getYearsList();
      expect(result).toEqual([
        { yearCode: '2026-27', displayName: '2026-27' },
        { yearCode: '2025-26', displayName: '2025-26' },
        { yearCode: '2024-25', displayName: '2024-25' },
      ]);
    });

    it('handles a single year without error', async () => {
      mockYearModel.find.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([{ year: '2021-22' }]) });
      const result = await service.getYearsList();
      expect(result).toHaveLength(1);
      expect((result as { yearCode: string }[])[0].yearCode).toBe('2021-22');
    });

    it('returns empty array when no active years exist', async () => {
      mockYearModel.find.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([]) });
      const result = await service.getYearsList();
      expect(result).toEqual([]);
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    const basePayload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: {} };

    it('resolves ulbCode and yearCode before any other operation', async () => {
      await service.create(basePayload as never, stateClient).catch(() => {});
      expect(mockReferenceResolverService.resolveUlbByCode).toHaveBeenCalledWith(validUlbCode);
      expect(mockReferenceResolverService.resolveYearByCode).toHaveBeenCalledWith(validYearCode);
    });

    it('calls ownership validation with resolved ulbId before DB write', async () => {
      await service.create(basePayload as never, stateClient).catch(() => {});
      expect(mockAuthorizationService.validateCanSubmitForUlb).toHaveBeenCalledWith(stateClient, validUlbId);
    });

    it('duplicate check filters only active records (isActive: true, status: ACTIVE)', async () => {
      await service.create(basePayload as never, stateClient).catch(() => {});
      const filterArg = (dcModel.findOne.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(filterArg).toMatchObject({ isActive: true, status: 'ACTIVE' });
    });

    it('throws ConflictException when data already exists', async () => {
      dcModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'existing' }) });
      await expect(service.create(basePayload as never, stateClient)).rejects.toThrow(ConflictException);
    });

    it('ConflictException message uses public codes not ObjectIds', async () => {
      dcModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'existing' }) });
      const err = await service.create(basePayload as never, stateClient).catch((e: unknown) => e);
      expect((err as ConflictException).message).toContain(validUlbCode);
      expect((err as ConflictException).message).toContain(validYearCode);
    });

    it('throws ForbiddenException when authorization fails', async () => {
      mockAuthorizationService.validateCanSubmitForUlb.mockRejectedValueOnce(
        new ForbiddenException('Client is not allowed to access this ULB.'),
      );
      await expect(service.create(basePayload as never, stateClient)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when ulbCode is not found', async () => {
      mockReferenceResolverService.resolveUlbByCode.mockRejectedValueOnce(
        new NotFoundException("ULB with code 'BAD' not found."),
      );
      await expect(service.create({ ...basePayload, ulbCode: 'BAD' } as never, stateClient)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when yearCode is not found', async () => {
      mockReferenceResolverService.resolveYearByCode.mockRejectedValueOnce(
        new NotFoundException("Year 'BAD' not found."),
      );
      await expect(service.create({ ...basePayload, yearCode: 'BAD' } as never, stateClient)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects unknown nmamCode with a clear error', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '999999': 100 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].lineItemCode).toBe('999999');
      expect(body.errors[0].message).toContain('does not exist in template version');
    });

    it('BadRequestException body uses public codes not ObjectIds', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '999999': 100 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as Record<string, unknown>;
      expect(body['ulbCode']).toBe(validUlbCode);
      expect(body['yearCode']).toBe(validYearCode);
      expect(body).not.toHaveProperty('ulbId');
      expect(body).not.toHaveProperty('yearId');
    });

    it('does not use hardcoded constant for key validation', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('CUSTOM_NEW')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { CUSTOM_NEW: 500 } };

      await service.create(payload as never, stateClient).catch(() => {});
      expect(mockLineItemsLegendService.getActiveLegendsForValidation).toHaveBeenCalled();
    });

    it('accepts 0 as a valid value', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 0 } };

      await service.create(payload as never, stateClient).catch(() => {});
      expect(dcModel).toHaveBeenCalledWith(expect.objectContaining({ templateVersion: '2026.1' }));
    });

    it('rejects null value', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': null } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors.some((e) => e.lineItemCode === '110')).toBe(true);
    });

    it('rejects string value', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 'not-a-number' } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('must be a finite number');
    });

    it('validates a correct formula sum when all operands are submitted', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002'] };
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { '110': 900, '11001': 500, '11002': 400 },
      };

      await service.create(payload as never, stateClient);
      expect(dcModel).toHaveBeenCalledWith(expect.objectContaining({ templateVersion: '2026.1' }));
    });

    it('rejects a formula sum mismatch when all operands are submitted', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002'] };
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { '110': 999, '11001': 500, '11002': 400 },
      };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('must equal sum of submitted operands');
      expect(body.errors[0].message).toContain('Expected: 900');
    });

    it('sparse: parent matches sum of the subset of operands that were submitted', async () => {
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
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { '110': 1300, '11010': 1000, '11006': 300 },
      };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['data']).toHaveProperty('validationStatus', 'VALID');
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
        ulbCode: validUlbCode,
        yearCode: validYearCode,
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
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 1300 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('cannot be validated because none of its operands were submitted');
    });

    it('passes when only operand children are submitted without the parent', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002'] };
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '11001': 500, '11002': 400 } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['data']).toHaveProperty('validationStatus', 'VALID');
    });

    it('fails when a formula rule references an operand not in the template', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', 'GHOST'] };
      const legends = [makeLegend('11001'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, '11001': 500 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('refers to unknown operand GHOST');
    });

    it('explicit 0 counts as a submitted operand and validates the formula', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002'] };
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { '110': 0, '11001': 0, '11002': 0 },
      };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['data']).toHaveProperty('validationStatus', 'VALID');
    });

    it('saves with VALID validationStatus and does not save invalid data', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['data']).toHaveProperty('validationStatus', 'VALID');
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
      const lineItems = { '110': 900, '11001': 500, '11002': 400 };
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems };

      await service.create(payload as never, stateClient);
      expect(dcModel).toHaveBeenCalledWith(expect.objectContaining({ lineItems }));
    });

    it('saves templateVersion on the document', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        templateVersion: '2026.1',
        lineItems: { '110': 500 },
      };

      await service.create(payload as never, stateClient);
      expect(dcModel).toHaveBeenCalledWith(expect.objectContaining({ templateVersion: '2026.1' }));
    });

    // ─── Storage field tests ───────────────────────────────────────────────

    it('stores ulbId as ObjectId on the document', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };
      await service.create(payload as never, stateClient);
      const docArg = (dcModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(docArg['ulbId']).toBeInstanceOf(Types.ObjectId);
      expect((docArg['ulbId'] as Types.ObjectId).toString()).toBe(validUlbId);
    });

    it('stores stateId as ObjectId on the document', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };
      await service.create(payload as never, stateClient);
      const docArg = (dcModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(docArg['stateId']).toBeInstanceOf(Types.ObjectId);
      expect((docArg['stateId'] as Types.ObjectId).toString()).toBe(validStateId);
    });

    it('stores yearId as ObjectId on the document', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };
      await service.create(payload as never, stateClient);
      const docArg = (dcModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(docArg['yearId']).toBeInstanceOf(Types.ObjectId);
      expect((docArg['yearId'] as Types.ObjectId).toString()).toBe(validYearId);
    });

    it('stores yearCode string on the document', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };
      await service.create(payload as never, stateClient);
      const docArg = (dcModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(docArg['yearCode']).toBe(validYearCode);
    });

    it('does NOT store ulbCode on the document', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };
      await service.create(payload as never, stateClient);
      const docArg = (dcModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(docArg).not.toHaveProperty('ulbCode');
    });

    // ─── External response shape tests ────────────────────────────────────

    it('response includes ulbCode and yearCode', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      const data = result['data'] as Record<string, unknown>;
      expect(data['ulbCode']).toBe(validUlbCode);
      expect(data['yearCode']).toBe(validYearCode);
    });

    it('response includes templateVersion, validationStatus, lineItems, createdAt, updatedAt', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      const data = result['data'] as Record<string, unknown>;
      expect(data).toHaveProperty('templateVersion');
      expect(data).toHaveProperty('validationStatus');
      expect(data).toHaveProperty('lineItems');
      expect(data).toHaveProperty('createdAt');
      expect(data).toHaveProperty('updatedAt');
    });

    it('response does not include _id, ulbId, stateId, yearId, __v', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      const data = result['data'] as Record<string, unknown>;
      expect(data).not.toHaveProperty('_id');
      expect(data).not.toHaveProperty('ulbId');
      expect(data).not.toHaveProperty('stateId');
      expect(data).not.toHaveProperty('yearId');
      expect(data).not.toHaveProperty('__v');
    });

    it('response message says Financial data submitted successfully', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['message']).toBe('Financial data submitted successfully.');
    });

    it('lineItems in response is a plain object, not a Map', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      const data = result['data'] as Record<string, unknown>;
      expect(data['lineItems']).not.toBeInstanceOf(Map);
      expect(data['lineItems']).toEqual({ '110': 500 });
    });

    // ─── Audit logging ─────────────────────────────────────────────────────

    it('calls logDuplicateSubmit before throwing ConflictException', async () => {
      dcModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'existing' }) });
      await service.create(basePayload as never, stateClient).catch(() => {});
      const arg = (mockAuditLogService.logDuplicateSubmit.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['apiClientId']).toBeInstanceOf(Types.ObjectId);
      expect(arg['stateId']).toEqual(new Types.ObjectId(validStateId));
      expect(arg['ulbId']).toEqual(new Types.ObjectId(validUlbId));
      expect(arg['yearId']).toEqual(new Types.ObjectId(validYearId));
      expectNoRemovedAuditFields(arg);
    });

    it('logDuplicateSubmit receives lineItemCount without submittedLineItemCodes', async () => {
      dcModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'existing' }) });
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 100, '11001': 200 } };
      await service.create(payload as never, stateClient).catch(() => {});
      const arg = (mockAuditLogService.logDuplicateSubmit.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['lineItemCount']).toBe(2);
      expect(arg).not.toHaveProperty('submittedLineItemCodes');
    });

    it('does not pass full lineItems values to logDuplicateSubmit', async () => {
      dcModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'existing' }) });
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 100 } };
      await service.create(payload as never, stateClient).catch(() => {});
      const arg = (mockAuditLogService.logDuplicateSubmit.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg).not.toHaveProperty('lineItems');
    });

    it('calls logValidationFailed before throwing BadRequestException on invalid keys', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { UNKNOWN: 100 } };
      await service.create(payload as never, stateClient).catch(() => {});
      expect(mockAuditLogService.logValidationFailed).toHaveBeenCalledWith(expect.objectContaining({ errorCount: 1 }));
    });

    it('logValidationFailed includes validationSummary with errors array', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { UNKNOWN: 100 } };
      await service.create(payload as never, stateClient).catch(() => {});
      const arg = (mockAuditLogService.logValidationFailed.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      const summary = arg['validationSummary'] as Record<string, unknown>;
      expect(Array.isArray(summary['errors'])).toBe(true);
      expect(arg['lineItemCount']).toBe(1);
      expectNoRemovedAuditFields(arg);
      expect(arg).not.toHaveProperty('lineItems');
    });

    it('calls logSubmitted on successful submission', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };
      await service.create(payload as never, stateClient);
      const arg = (mockAuditLogService.logSubmitted.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg).toEqual(
        expect.objectContaining({
          apiClientId: expect.any(Types.ObjectId) as Types.ObjectId,
          stateId: new Types.ObjectId(validStateId),
          ulbId: new Types.ObjectId(validUlbId),
          yearId: new Types.ObjectId(validYearId),
          templateVersion: '2026.1',
          lineItemCount: 1,
          validationStatus: 'VALID',
        }),
      );
      expectNoRemovedAuditFields(arg);
    });

    it('passes ip and userAgent from meta to audit log', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };
      await service.create(payload as never, stateClient, { ip: '10.0.0.1', userAgent: 'ua/2' });
      expect(mockAuditLogService.logSubmitted).toHaveBeenCalledWith(
        expect.objectContaining({ ip: '10.0.0.1', userAgent: 'ua/2' }),
      );
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    const basePayload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } };

    it('resolves ulbCode and yearCode before any other operation', async () => {
      dcModel.findOne.mockReturnValue({
        lineItems: new Map(),
        save: jest.fn().mockResolvedValue(makeDocSaveResult()),
      });
      await service.update(basePayload as never, stateClient).catch(() => {});
      expect(mockReferenceResolverService.resolveUlbByCode).toHaveBeenCalledWith(validUlbCode);
      expect(mockReferenceResolverService.resolveYearByCode).toHaveBeenCalledWith(validYearCode);
    });

    it('calls ownership validation with resolved ulbId before DB write', async () => {
      dcModel.findOne.mockReturnValue({
        lineItems: new Map(),
        save: jest.fn().mockResolvedValue(makeDocSaveResult()),
      });
      await service.update(basePayload as never, stateClient).catch(() => {});
      expect(mockAuthorizationService.validateCanModifyForUlb).toHaveBeenCalledWith(stateClient, validUlbId);
    });

    it('findOne for update filters only active records (isActive: true, status: ACTIVE)', async () => {
      dcModel.findOne.mockReturnValue(null);
      await service.update(basePayload as never, stateClient).catch(() => {});
      const filterArg = (dcModel.findOne.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(filterArg).toMatchObject({ isActive: true, status: 'ACTIVE' });
    });

    it('throws NotFoundException when data does not exist', async () => {
      dcModel.findOne.mockReturnValue(null);
      await expect(service.update(basePayload as never, stateClient)).rejects.toThrow(NotFoundException);
    });

    it('NotFoundException message uses public codes not ObjectIds', async () => {
      dcModel.findOne.mockReturnValue(null);
      const err = await service.update(basePayload as never, stateClient).catch((e: unknown) => e);
      expect((err as NotFoundException).message).toContain(validUlbCode);
      expect((err as NotFoundException).message).toContain(validYearCode);
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
        save: jest.fn().mockResolvedValue(
          makeDocSaveResult({
            lineItems: new Map([
              ['11001', 600],
              ['110', 1000],
              ['11002', 400],
            ]),
          }),
        ),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      const legends = [makeLegend('110'), makeLegend('11001'), makeLegend('11002')];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);

      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 1000, '11002': 400 } };
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
      dcModel.findOne.mockReturnValue({
        templateVersion: '2026.1',
        lineItems: new Map(),
        save: jest.fn(),
      });

      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        templateVersion: '2027.1',
        lineItems: { '110': 500 },
      };
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

      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': null } };
      const err = await service.update(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors.some((e) => e.lineItemCode === '110')).toBe(true);
    });

    it('stamps templateVersion on existing documents that lack it', async () => {
      const existingDoc = {
        templateVersion: undefined as unknown as string,
        lineItems: new Map<string, number>([['110', 500]]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);

      await service.update(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500 } } as never,
        stateClient,
      );
      expect(existingDoc.templateVersion).toBe('2026.1');
    });

    it('validates merged sparse data — parent must match submitted operand sum after merge', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002', '11003'] };
      const existingDoc = {
        templateVersion: '2026.1',
        lineItems: new Map<string, number>([['11001', 600]]),
        save: jest.fn().mockResolvedValue(
          makeDocSaveResult({
            lineItems: new Map([
              ['11001', 600],
              ['110', 1600],
              ['11002', 1000],
            ]),
          }),
        ),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([
        makeLegend('11001'),
        makeLegend('11002'),
        makeLegend('11003'),
        makeLegend('110', [sumRule] as never),
      ]);

      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 1600, '11002': 1000 } };
      const result = (await service.update(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['data']).toHaveProperty('validationStatus', 'VALID');
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

      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 1300, '11002': 500 } };
      const err = await service.update(payload as never, stateClient).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('must equal sum of submitted operands');
      expect(body.errors[0].message).toContain('Expected: 1100');
    });

    // ─── Update-specific storage + response tests ─────────────────────────

    it('backfills stateId when missing from an older record', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: undefined as unknown as Types.ObjectId,
        yearCode: validYearCode,
        lineItems: new Map<string, number>([['110', 500]]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);

      await service.update(basePayload as never, stateClient);
      expect(existingDoc.stateId).toEqual(new Types.ObjectId(validStateId));
    });

    it('backfills yearCode when missing from an older record', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: undefined as unknown as string,
        lineItems: new Map<string, number>([['110', 500]]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);

      await service.update(basePayload as never, stateClient);
      expect(existingDoc.yearCode).toBe(validYearCode);
    });

    it('response includes ulbCode and yearCode', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>(),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);

      const result = (await service.update(basePayload as never, stateClient)) as Record<string, unknown>;
      const data = result['data'] as Record<string, unknown>;
      expect(data['ulbCode']).toBe(validUlbCode);
      expect(data['yearCode']).toBe(validYearCode);
    });

    it('response does not include internal Mongo IDs', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>(),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);

      const result = (await service.update(basePayload as never, stateClient)) as Record<string, unknown>;
      const data = result['data'] as Record<string, unknown>;
      expect(data).not.toHaveProperty('_id');
      expect(data).not.toHaveProperty('ulbId');
      expect(data).not.toHaveProperty('stateId');
      expect(data).not.toHaveProperty('yearId');
      expect(data).not.toHaveProperty('__v');
    });

    it('response message says Financial data updated successfully', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>(),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);

      const result = (await service.update(basePayload as never, stateClient)) as Record<string, unknown>;
      expect(result['message']).toBe('Financial data updated successfully.');
    });

    // ─── Audit logging ─────────────────────────────────────────────────────

    it('calls logModifyNotFound before throwing NotFoundException', async () => {
      dcModel.findOne.mockReturnValue(null);
      await service.update(basePayload as never, stateClient).catch(() => {});
      const arg = (mockAuditLogService.logModifyNotFound.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['apiClientId']).toBeInstanceOf(Types.ObjectId);
      expect(arg['stateId']).toEqual(new Types.ObjectId(validStateId));
      expect(arg['ulbId']).toEqual(new Types.ObjectId(validUlbId));
      expect(arg['yearId']).toEqual(new Types.ObjectId(validYearId));
      expect(arg['lineItemCount']).toBe(1);
      expectNoRemovedAuditFields(arg);
    });

    it('calls logValidationFailed before throwing BadRequestException on merged data', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        lineItems: new Map<string, number>([['110', 1000]]),
        save: jest.fn(),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([]);
      await service.update(basePayload as never, stateClient).catch(() => {});
      expect(mockAuditLogService.logValidationFailed).toHaveBeenCalledWith(
        expect.objectContaining({ errorCount: expect.any(Number) as unknown as number }),
      );
      const arg = (mockAuditLogService.logValidationFailed.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['lineItemCount']).toBe(1);
      expectNoRemovedAuditFields(arg);
      expect(arg).not.toHaveProperty('lineItems');
    });

    it('calls logModified on successful update', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>(),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      await service.update(basePayload as never, stateClient);
      const arg = (mockAuditLogService.logModified.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg).toEqual(
        expect.objectContaining({
          apiClientId: expect.any(Types.ObjectId) as Types.ObjectId,
          stateId: new Types.ObjectId(validStateId),
          ulbId: new Types.ObjectId(validUlbId),
          yearId: new Types.ObjectId(validYearId),
          templateVersion: '2026.1',
          lineItemCount: 1,
          changedLineItemCodes: ['110'],
          validationStatus: 'VALID',
        }),
      );
      expectNoRemovedAuditFields(arg);
    });

    it('changedLineItemCodes reflects keys whose values differ from existing', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>([['110', 999]]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      await service.update(basePayload as never, stateClient);
      const arg = (mockAuditLogService.logModified.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['changedLineItemCodes']).toContain('110');
    });

    it('changedLineItemCodes omits keys whose values are unchanged', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>([['110', 500]]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      await service.update(basePayload as never, stateClient);
      const arg = (mockAuditLogService.logModified.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['changedLineItemCodes']).toEqual([]);
    });

    it('does not pass full merged lineItems to logModified', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>(),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      await service.update(basePayload as never, stateClient);
      const arg = (mockAuditLogService.logModified.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg).not.toHaveProperty('lineItems');
    });
  });

  // ─── reverseSubmission ────────────────────────────────────────────────────

  describe('reverseSubmission', () => {
    const reversePayload = { ulbCode: validUlbCode, yearCode: validYearCode, reason: 'Test reason for reversal' };
    const reversedDocId = new Types.ObjectId();
    const mockReversedAt = new Date('2026-05-25T00:00:00.000Z');

    const makeActiveDoc = (overrides: object = {}) => ({
      _id: reversedDocId,
      isActive: true,
      status: 'ACTIVE',
      templateVersion: '2026.1',
      reversedAt: undefined as unknown as Date,
      reversalReason: undefined as unknown as string,
      save: jest.fn().mockResolvedValue({
        _id: reversedDocId,
        templateVersion: '2026.1',
        status: 'REVERSED',
        isActive: false,
        reversedAt: mockReversedAt,
        reversalReason: reversePayload.reason,
      }),
      ...overrides,
    });

    it('resolves ulbCode and yearCode', async () => {
      dcModel.findOne.mockReturnValue(makeActiveDoc());
      await service.reverseSubmission(reversePayload, adminUser);
      expect(mockReferenceResolverService.resolveUlbByCode).toHaveBeenCalledWith(validUlbCode);
      expect(mockReferenceResolverService.resolveYearByCode).toHaveBeenCalledWith(validYearCode);
    });

    it('findOne filters by isActive: true and status: ACTIVE', async () => {
      dcModel.findOne.mockReturnValue(makeActiveDoc());
      await service.reverseSubmission(reversePayload, adminUser);
      const filterArg = (dcModel.findOne.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(filterArg).toMatchObject({ isActive: true, status: 'ACTIVE' });
    });

    it('throws NotFoundException when no active record exists', async () => {
      dcModel.findOne.mockReturnValue(null);
      await expect(service.reverseSubmission(reversePayload, adminUser)).rejects.toThrow(NotFoundException);
    });

    it('NotFoundException message uses public codes not ObjectIds', async () => {
      dcModel.findOne.mockReturnValue(null);
      const err = await service.reverseSubmission(reversePayload, adminUser).catch((e: unknown) => e);
      expect((err as NotFoundException).message).toContain(validUlbCode);
      expect((err as NotFoundException).message).toContain(validYearCode);
    });

    it('marks the record as reversed', async () => {
      const doc = makeActiveDoc();
      dcModel.findOne.mockReturnValue(doc);
      await service.reverseSubmission(reversePayload, adminUser);
      expect(doc.isActive).toBe(false);
      expect(doc.status).toBe('REVERSED');
      expect(doc.reversedAt).toBeInstanceOf(Date);
      expect(doc.reversalReason).toBe(reversePayload.reason);
    });

    it('sets reversedBy to the admin ObjectId', async () => {
      const doc = makeActiveDoc();
      dcModel.findOne.mockReturnValue(doc);
      await service.reverseSubmission(reversePayload, adminUser);
      expect((doc as Record<string, unknown>)['reversedBy']).toBeInstanceOf(Types.ObjectId);
      expect(((doc as Record<string, unknown>)['reversedBy'] as Types.ObjectId).toString()).toBe(validAdminId);
    });

    it('calls logReversed with adminUserId, dataCollectionId, reason', async () => {
      dcModel.findOne.mockReturnValue(makeActiveDoc());
      await service.reverseSubmission(reversePayload, adminUser);
      expect(mockAuditLogService.logReversed).toHaveBeenCalledWith(
        expect.objectContaining({
          adminUserId: expect.any(Types.ObjectId) as Types.ObjectId,
          dataCollectionId: reversedDocId,
          reason: reversePayload.reason,
          stateId: new Types.ObjectId(validStateId),
          ulbId: new Types.ObjectId(validUlbId),
          yearId: new Types.ObjectId(validYearId),
        }),
      );
    });

    it('response has message and data with status REVERSED', async () => {
      dcModel.findOne.mockReturnValue(makeActiveDoc());
      const result = (await service.reverseSubmission(reversePayload, adminUser)) as Record<string, unknown>;
      expect(result['message']).toContain('reversed');
      const data = result['data'] as Record<string, unknown>;
      expect(data['status']).toBe('REVERSED');
      expect(data['ulbCode']).toBe(validUlbCode);
      expect(data['yearCode']).toBe(validYearCode);
    });

    it('response data does not include internal Mongo IDs', async () => {
      dcModel.findOne.mockReturnValue(makeActiveDoc());
      const result = (await service.reverseSubmission(reversePayload, adminUser)) as Record<string, unknown>;
      const data = result['data'] as Record<string, unknown>;
      expect(data).not.toHaveProperty('_id');
      expect(data).not.toHaveProperty('ulbId');
      expect(data).not.toHaveProperty('stateId');
      expect(data).not.toHaveProperty('yearId');
    });

    it('passes ip and userAgent from meta to logReversed', async () => {
      dcModel.findOne.mockReturnValue(makeActiveDoc());
      await service.reverseSubmission(reversePayload, adminUser, { ip: '10.0.0.1', userAgent: 'admin/1.0' });
      expect(mockAuditLogService.logReversed).toHaveBeenCalledWith(
        expect.objectContaining({ ip: '10.0.0.1', userAgent: 'admin/1.0' }),
      );
    });
  });

  // ─── rule metadata in validation errors ───────────────────────────────────

  describe('rule metadata in validation errors', () => {
    const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002'] };

    it('formula mismatch error includes validationRule, submittedOperands, expected, received', async () => {
      const legends = [makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { '110': 999, '11001': 500, '11002': 400 },
      };

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
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { '110': 999, '11001': 500, '11002': 400 },
      };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors[0];

      expect(issue.lineItemCode).toBe('110');
      expect(issue.value).toBe(999);
      expect(issue.severity).toBe('ERROR');
      expect(issue.message).toContain('must equal sum of submitted operands');
    });

    it('sparse mismatch includes only the submitted subset in submittedOperands', async () => {
      const sparseRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002', '11003'] };
      const legends = [
        makeLegend('11001'),
        makeLegend('11002'),
        makeLegend('11003'),
        makeLegend('110', [sparseRule] as never),
      ];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { '110': 999, '11001': 500, '11003': 400 },
      };

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
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 1300 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors[0];

      expect(issue.validationRule).toMatchObject({ type: 'formula', operation: 'sum' });
      expect(issue.submittedOperands).toEqual([]);
      expect(issue.expected).toBeNull();
      expect(issue.received).toBe(1300);
    });

    it('template integrity error includes validationRule, submittedOperands so far, expected null', async () => {
      const ruleWithGhost = { type: 'formula', operation: 'sum', operands: ['11001', 'GHOST'] };
      const legends = [makeLegend('11001'), makeLegend('110', [ruleWithGhost] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, '11001': 500 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors[0];

      expect(issue.validationRule).toMatchObject({ operands: ['11001', 'GHOST'] });
      expect(issue.expected).toBeNull();
      expect(issue.received).toBe(500);
    });

    it('unknown code error does not include validationRule', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '999999': 100 } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };

      expect(body.errors[0]).not.toHaveProperty('validationRule');
    });

    it('invalid value error does not include validationRule', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 'bad' } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };

      expect(body.errors[0]).not.toHaveProperty('validationRule');
    });

    it('null value error does not include validationRule', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': null } };

      const err = await service.create(payload as never, stateClient).catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };

      expect(body.errors[0]).not.toHaveProperty('validationRule');
    });
  });
});
