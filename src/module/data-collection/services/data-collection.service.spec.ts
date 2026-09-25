import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { User } from 'src/module/auth/enum/role.enum';
import type { ApiClientContext } from 'src/module/auth/types/api-client-context.type';
import { LineItemsLegendService } from 'src/module/line-items-legends/line-items-legend.service';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
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

const makeComputedLegend = (nmamCode: string, rules = []) => ({
  nmamCode,
  name: `Computed ${nmamCode}`,
  accountHead: 'COMPUTED',
  level: 1,
  parentCode: null,
  rules,
  isComputed: true,
});

/** Returns legends for every source code used in DATA_COLLECTION_COMPUTED_CONFIG.
 *  Required so validateComputedTotals runs all four metric checks. */
const makeComputedSourceLegends = () =>
  [
    '110',
    '120',
    '130',
    '140',
    '150',
    '160',
    '170',
    '171',
    '180', // income / revenue / ownRevenue
    '210',
    '220',
    '230',
    '240',
    '250',
    '260',
    '272',
    '280',
    '290', // expenditure
  ].map((code) => makeLegend(code));

/**
 * Sets `getActiveLegendsForValidation` to return all computed source legends PLUS
 * any test-specific extras. Extra legends placed last override duplicates (Map keeps last).
 * Use this whenever create/update must succeed so computed totals pass validation.
 */
const mockLegendsFor = (extras: ReturnType<typeof makeLegend>[] = []) => {
  mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([
    ...makeComputedSourceLegends(),
    ...extras,
  ]);
};

/**
 * Extra line items that guarantee all four computed comparison rules pass when
 * merged with a test payload (only meaningful when mockLegendsFor is also used).
 */
const computedExtras = { '120': 1, '210': 1 } as const;

/**
 * Creates a DB-driven computed legend record (isComputed: true) with a sum formula
 * and a comparison rule. Mirrors the format stored in the lineitemslegends collection.
 */
const makeDbComputedLegend = (
  key: 'totIncome' | 'totExpenditure' | 'totRevenue' | 'totOwnRevenue',
  sourceCodes: string[],
  operator: string,
  threshold: number,
) => ({
  nmamCode: `computed.${key}`,
  name: `Total ${key.replace('tot', '')}`,
  accountHead: 'COMPUTED',
  level: 1,
  parentCode: null,
  isComputed: true,
  rules: [
    { type: 'formula', operation: 'sum', operands: sourceCodes },
    { type: 'comparison', operator, value: threshold },
  ],
});

/** Returns the four canonical computed legends matching the spec requirements. */
const makeAllComputedLegends = () => [
  makeDbComputedLegend('totIncome', ['110', '120', '130', '140', '150', '160', '170', '171', '180'], '!==', 0),
  makeDbComputedLegend('totExpenditure', ['210', '220', '230', '240', '250', '260', '272', '280', '290'], '>', 0),
  makeDbComputedLegend('totRevenue', ['110', '120', '130', '140', '150', '160', '170', '171', '180'], '>', 0),
  makeDbComputedLegend('totOwnRevenue', ['110', '130', '140', '150', '170', '171', '180'], '>=', 0),
];

/** Full legend set: source code legends (regular) + computed legends (isComputed: true). */
const makeFullLegendSet = () => [...makeComputedSourceLegends(), ...makeAllComputedLegends()];

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

const ulbClient: ApiClientContext = {
  apiClientId: validApiClientId,
  clientId: 'c2',
  actorType: 'ULB',
  stateId: validStateId,
  ulbId: validUlbId,
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

type SavedDataCollectionOverrides = Partial<{
  templateVersion: string;
  validationStatus: 'VALID' | 'WARNING';
  status: 'ACTIVE';
  lineItems: Map<string, number>;
}>;

/** Builds a minimal saved document returned by Mongoose save(). */
const makeDocSaveResult = (overrides: SavedDataCollectionOverrides = {}) => ({
  templateVersion: overrides.templateVersion ?? '2026.1',
  validationStatus: overrides.validationStatus ?? 'VALID',
  status: overrides.status ?? 'ACTIVE',
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

/**
 * Returns a minimal Mongoose-document-like object for use in update() tests.
 * update() calls findOne() WITHOUT .lean(), so it needs a hydrated document with .save().
 */
const makeUpdateRecord = (overrides: Partial<{ templateVersion: string; lineItems: Map<string, number> }> = {}) => ({
  templateVersion: overrides.templateVersion ?? '2026.1',
  lineItems: overrides.lineItems ?? new Map<string, number>([['110', 500]]),
  save: jest.fn().mockResolvedValue(makeDocSaveResult()),
});

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
  validateCanAccessUlb: jest.fn().mockResolvedValue(undefined),
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

type ReadDataCollectionRecord = {
  _id: Types.ObjectId;
  __v: number;
  ulbId: Types.ObjectId;
  stateId: Types.ObjectId;
  yearId: Types.ObjectId;
  templateVersion: string;
  validationStatus: 'VALID' | 'WARNING';
  status: 'ACTIVE';
  isActive: boolean;
  lineItems: Map<string, number> | Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
  reversedAt?: Date;
  reversedBy?: Types.ObjectId;
  reversalReason?: string;
};

const makeReadRecord = (overrides: Partial<ReadDataCollectionRecord> = {}): ReadDataCollectionRecord => ({
  _id: new Types.ObjectId(),
  __v: 0,
  ulbId: new Types.ObjectId(validUlbId),
  stateId: new Types.ObjectId(validStateId),
  yearId: new Types.ObjectId(validYearId),
  templateVersion: '2026.1',
  validationStatus: 'VALID',
  status: 'ACTIVE',
  isActive: true,
  lineItems: new Map<string, number>([
    ['110', 500],
    ['120', 0],
  ]),
  createdAt: mockDate,
  updatedAt: mockDate,
  ...overrides,
});

const makeFindOneLean = (result: ReadDataCollectionRecord | null) => ({
  lean: jest.fn().mockResolvedValue(result),
});

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
    mockAuthorizationService.validateCanAccessUlb.mockResolvedValue(undefined);
    mockAuthorizationService.validateCanSubmitForUlb.mockResolvedValue(undefined);
    mockAuthorizationService.validateCanModifyForUlb.mockResolvedValue(undefined);
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

  describe('findOneByUlbAndYear', () => {
    const query = { ulbCode: validUlbCode, yearCode: validYearCode };

    it('returns active record by ulbCode and yearCode', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(makeReadRecord()));

      const result = await service.findOneByUlbAndYear(query, stateClient);

      expect(mockReferenceResolverService.resolveUlbByCode).toHaveBeenCalledWith(validUlbCode);
      expect(mockReferenceResolverService.resolveYearByCode).toHaveBeenCalledWith(validYearCode);
      expect(result).toEqual({
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        templateVersion: '2026.1',
        validationStatus: 'VALID',
        status: 'ACTIVE',
        lineItems: { '110': 500, '120': 0 },
        createdAt: mockDate,
        updatedAt: mockDate,
      });
    });

    it('queries only active submitted records with resolved ids', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(makeReadRecord()));
      await service.findOneByUlbAndYear(query, stateClient);

      const filterArg = (dcModel.findOne.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(filterArg).toMatchObject({
        ulbId: new Types.ObjectId(validUlbId),
        yearId: new Types.ObjectId(validYearId),
        isActive: true,
        status: 'ACTIVE',
      });
    });

    it('uses lean for the read-only data collection query', async () => {
      const chain = makeFindOneLean(makeReadRecord());
      dcModel.findOne.mockReturnValueOnce(chain);
      await service.findOneByUlbAndYear(query, stateClient);
      expect(chain.lean).toHaveBeenCalled();
    });

    it('applies optional templateVersion', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(makeReadRecord()));
      await service.findOneByUlbAndYear({ ...query, templateVersion: '2026.1' }, stateClient);

      const filterArg = (dcModel.findOne.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(filterArg['templateVersion']).toBe('2026.1');
    });

    it('ULB client can fetch own ULB data', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(makeReadRecord()));
      await service.findOneByUlbAndYear(query, ulbClient);
      expect(mockAuthorizationService.validateCanAccessUlb).toHaveBeenCalledWith(ulbClient, validUlbId);
    });

    it('ULB client cannot fetch another ULB data', async () => {
      mockAuthorizationService.validateCanAccessUlb.mockRejectedValueOnce(
        new ForbiddenException('Client is not allowed to access this ULB.'),
      );

      await expect(service.findOneByUlbAndYear(query, ulbClient)).rejects.toThrow(ForbiddenException);
      expect(dcModel.findOne).not.toHaveBeenCalled();
    });

    it('State client can fetch ULB under its state', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(makeReadRecord()));
      await service.findOneByUlbAndYear(query, stateClient);
      expect(mockAuthorizationService.validateCanAccessUlb).toHaveBeenCalledWith(stateClient, validUlbId);
    });

    it('State client cannot fetch ULB outside its state', async () => {
      mockAuthorizationService.validateCanAccessUlb.mockRejectedValueOnce(
        new ForbiddenException('Client is not allowed to access this ULB.'),
      );

      await expect(service.findOneByUlbAndYear(query, stateClient)).rejects.toThrow(ForbiddenException);
      expect(dcModel.findOne).not.toHaveBeenCalled();
    });

    it('reversed record is not returned', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(null));

      await expect(service.findOneByUlbAndYear(query, stateClient)).rejects.toThrow(NotFoundException);
      const filterArg = (dcModel.findOne.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(filterArg['status']).toBe('ACTIVE');
    });

    it('inactive record is not returned', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(null));

      await expect(service.findOneByUlbAndYear(query, stateClient)).rejects.toThrow(NotFoundException);
      const filterArg = (dcModel.findOne.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(filterArg['isActive']).toBe(true);
    });

    it('not found throws NotFoundException with data collection error code', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(null));

      const err = await service.findOneByUlbAndYear(query, stateClient).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).message).toBe(
        `Financial data for ulbCode: ${validUlbCode} and yearCode: ${validYearCode} does not exist.`,
      );
      expect((err as NotFoundException).getResponse()).toMatchObject({ code: 'DATA_COLLECTION_NOT_FOUND' });
    });

    it('not-found message without templateVersion omits templateVersion', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(null));
      const err = await service.findOneByUlbAndYear(query, stateClient).catch((e: unknown) => e);
      expect((err as NotFoundException).message).not.toContain('templateVersion');
    });

    it('not-found message with templateVersion includes templateVersion in the message', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(null));
      const err = await service
        .findOneByUlbAndYear({ ...query, templateVersion: 'alpha' }, stateClient)
        .catch((e: unknown) => e);
      expect((err as NotFoundException).message).toContain(validUlbCode);
      expect((err as NotFoundException).message).toContain(validYearCode);
      expect((err as NotFoundException).message).toContain('alpha');
    });

    it('response does not contain internal Mongo fields', async () => {
      dcModel.findOne.mockReturnValueOnce(
        makeFindOneLean(
          makeReadRecord({
            reversedAt: new Date('2024-02-01T00:00:00.000Z'),
            reversedBy: new Types.ObjectId(),
            reversalReason: 'Incorrect submission',
          }),
        ),
      );

      const result = (await service.findOneByUlbAndYear(query, stateClient)) as Record<string, unknown>;

      expect(result).not.toHaveProperty('_id');
      expect(result).not.toHaveProperty('ulbId');
      expect(result).not.toHaveProperty('stateId');
      expect(result).not.toHaveProperty('yearId');
      expect(result).not.toHaveProperty('__v');
      expect(result).not.toHaveProperty('reversedAt');
      expect(result).not.toHaveProperty('reversedBy');
      expect(result).not.toHaveProperty('reversalReason');
      expect(result).not.toHaveProperty('apiClientId');
    });

    it('lineItems remains sparse', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(makeReadRecord({ lineItems: { '110': 500 } })));

      const result = await service.findOneByUlbAndYear(query, stateClient);

      expect(result.lineItems).toEqual({ '110': 500 });
      expect(result.lineItems).not.toHaveProperty('120');
    });

    it('0 values are preserved', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(makeReadRecord({ lineItems: { '110': 0 } })));

      const result = await service.findOneByUlbAndYear(query, stateClient);

      expect(result.lineItems).toEqual({ '110': 0 });
    });

    it('does not audit normal GET requests', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(makeReadRecord()));

      await service.findOneByUlbAndYear(query, stateClient);

      expect(mockAuditLogService.logSubmitted).not.toHaveBeenCalled();
      expect(mockAuditLogService.logModified).not.toHaveBeenCalled();
      expect(mockAuditLogService.logValidationFailed).not.toHaveBeenCalled();
      expect(mockAuditLogService.logDuplicateSubmit).not.toHaveBeenCalled();
      expect(mockAuditLogService.logModifyNotFound).not.toHaveBeenCalled();
      expect(mockAuditLogService.logReversed).not.toHaveBeenCalled();
    });
  });

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

    it('stores apiClientId from the API client context', async () => {
      mockLegendsFor();
      await service.create(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 100, ...computedExtras } } as never,
        stateClient,
      );
      const modelCallArg = (dcModel.mock.calls[0] as unknown[][])[0] as unknown as Record<string, unknown>;
      expect(modelCallArg['apiClientId']).toBeInstanceOf(Types.ObjectId);
      expect((modelCallArg['apiClientId'] as Types.ObjectId).toString()).toBe(validApiClientId);
    });

    it('throws InternalServerErrorException when apiClientId is not a valid ObjectId', async () => {
      const invalidClient = { ...stateClient, apiClientId: 'not-a-valid-id' };
      await expect(
        service.create({ ulbCode: validUlbCode, yearCode: validYearCode, lineItems: {} } as never, invalidClient),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('does not expose apiClientId in the create response', async () => {
      mockLegendsFor();
      const result = (await service.create(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 100, ...computedExtras } } as never,
        stateClient,
      )) as Record<string, unknown>;
      expect(result['data'] as Record<string, unknown>).not.toHaveProperty('apiClientId');
    });

    it('duplicate submit audit log includes the existing dataCollectionId', async () => {
      const existingId = new Types.ObjectId();
      dcModel.findOne.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue({ _id: existingId }) });
      await service.create(basePayload as never, stateClient).catch(() => {});
      expect(mockAuditLogService.logDuplicateSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ dataCollectionId: existingId }),
      );
    });

    it('submit success audit log includes dataCollectionId', async () => {
      const savedId = new Types.ObjectId();
      mockLegendsFor();
      mockSave.mockResolvedValueOnce({ ...makeDocSaveResult(), _id: savedId });
      await service.create(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 100, ...computedExtras } } as never,
        stateClient,
      );
      expect(mockAuditLogService.logSubmitted).toHaveBeenCalledWith(
        expect.objectContaining({ dataCollectionId: savedId }),
      );
    });

    it('does not use hardcoded constant for key validation', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('CUSTOM_NEW')]);
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { CUSTOM_NEW: 500 } };

      await service.create(payload as never, stateClient).catch(() => {});
      expect(mockLineItemsLegendService.getActiveLegendsForValidation).toHaveBeenCalled();
    });

    it('accepts 0 as a valid value — 0 is stored, not rejected as invalid type', async () => {
      mockLegendsFor();
      // '110': 0 is valid. '120': 1 keeps totIncome ≠ 0; '210': 1 keeps totExpenditure > 0.
      await service.create(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 0, ...computedExtras } } as never,
        stateClient,
      );
      const modelCallArg = (dcModel.mock.calls[0] as unknown[][])[0] as unknown as Record<string, unknown>;
      expect((modelCallArg['lineItems'] as Record<string, unknown>)['110']).toBe(0);
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
      mockLegendsFor([makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)]);
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { '110': 900, '11001': 500, '11002': 400, ...computedExtras },
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
      mockLegendsFor([
        makeLegend('11001'),
        makeLegend('11002'),
        makeLegend('11003'),
        makeLegend('11010'),
        makeLegend('11006'),
        makeLegend('110', [sumRule] as never),
      ]);
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { '110': 1300, '11010': 1000, '11006': 300, ...computedExtras },
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
      mockLegendsFor([makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)]);
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { '11001': 500, '11002': 400, ...computedExtras },
      };

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
      mockLegendsFor([makeLegend('11001'), makeLegend('11002'), makeLegend('110', [sumRule] as never)]);
      // '110': 0, '11001': 0, '11002': 0 — sum passes (0 = 0+0).
      // computedExtras keeps totIncome ≠ 0 and totExpenditure > 0.
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { '110': 0, '11001': 0, '11002': 0, ...computedExtras },
      };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['data']).toHaveProperty('validationStatus', 'VALID');
    });

    it('saves with VALID validationStatus and does not save invalid data', async () => {
      mockLegendsFor();
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['data']).toHaveProperty('validationStatus', 'VALID');
      expect(dcModel).toHaveBeenCalledWith(expect.objectContaining({ validationStatus: 'VALID' }));
    });

    it('saves sparse lineItems without padding unsubmitted template keys', async () => {
      const sumRule = { type: 'formula', operation: 'sum', operands: ['11001', '11002', '11003'] };
      mockLegendsFor([
        makeLegend('11001'),
        makeLegend('11002'),
        makeLegend('11003'),
        makeLegend('110', [sumRule] as never),
      ]);
      const submittedLineItems = { '110': 900, '11001': 500, '11002': 400, ...computedExtras };
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: submittedLineItems };

      await service.create(payload as never, stateClient);
      // Stored lineItems must contain all submitted keys/values; no '11003' padding
      const docArg = (dcModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(docArg['lineItems']).toMatchObject({ '110': 900, '11001': 500, '11002': 400 });
      expect(docArg['lineItems']).not.toMatchObject({ '11003': expect.anything() });
    });

    it('saves templateVersion on the document', async () => {
      mockLegendsFor();
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        templateVersion: '2026.1',
        lineItems: { '110': 500, ...computedExtras },
      };

      await service.create(payload as never, stateClient);
      expect(dcModel).toHaveBeenCalledWith(expect.objectContaining({ templateVersion: '2026.1' }));
    });

    // ─── Storage field tests ───────────────────────────────────────────────

    it('stores ulbId as ObjectId on the document', async () => {
      mockLegendsFor();
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };
      await service.create(payload as never, stateClient);
      const docArg = (dcModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(docArg['ulbId']).toBeInstanceOf(Types.ObjectId);
      expect((docArg['ulbId'] as Types.ObjectId).toString()).toBe(validUlbId);
    });

    it('stores stateId as ObjectId on the document', async () => {
      mockLegendsFor();
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };
      await service.create(payload as never, stateClient);
      const docArg = (dcModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(docArg['stateId']).toBeInstanceOf(Types.ObjectId);
      expect((docArg['stateId'] as Types.ObjectId).toString()).toBe(validStateId);
    });

    it('stores yearId as ObjectId on the document', async () => {
      mockLegendsFor();
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };
      await service.create(payload as never, stateClient);
      const docArg = (dcModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(docArg['yearId']).toBeInstanceOf(Types.ObjectId);
      expect((docArg['yearId'] as Types.ObjectId).toString()).toBe(validYearId);
    });

    it('stores yearCode string on the document', async () => {
      mockLegendsFor();
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };
      await service.create(payload as never, stateClient);
      const docArg = (dcModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(docArg['yearCode']).toBe(validYearCode);
    });

    it('does NOT store ulbCode on the document', async () => {
      mockLegendsFor();
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };
      await service.create(payload as never, stateClient);
      const docArg = (dcModel.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(docArg).not.toHaveProperty('ulbCode');
    });

    // ─── External response shape tests ────────────────────────────────────

    it('response includes ulbCode and yearCode', async () => {
      mockLegendsFor();
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      const data = result['data'] as Record<string, unknown>;
      expect(data['ulbCode']).toBe(validUlbCode);
      expect(data['yearCode']).toBe(validYearCode);
    });

    it('response includes templateVersion, validationStatus, lineItems, createdAt, updatedAt', async () => {
      mockLegendsFor();
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      const data = result['data'] as Record<string, unknown>;
      expect(data).toHaveProperty('templateVersion');
      expect(data).toHaveProperty('validationStatus');
      expect(data).toHaveProperty('lineItems');
      expect(data).toHaveProperty('createdAt');
      expect(data).toHaveProperty('updatedAt');
    });

    it('response does not include _id, ulbId, stateId, yearId, __v', async () => {
      mockLegendsFor();
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      const data = result['data'] as Record<string, unknown>;
      expect(data).not.toHaveProperty('_id');
      expect(data).not.toHaveProperty('ulbId');
      expect(data).not.toHaveProperty('stateId');
      expect(data).not.toHaveProperty('yearId');
      expect(data).not.toHaveProperty('__v');
    });

    it('response message says Financial data submitted successfully', async () => {
      mockLegendsFor();
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };

      const result = (await service.create(payload as never, stateClient)) as Record<string, unknown>;
      expect(result['message']).toBe('Financial data submitted successfully.');
    });

    it('lineItems in response is a plain object, not a Map', async () => {
      mockLegendsFor();
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };

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
      // computedExtras keeps computed totals passing; only UNKNOWN fails validation → errorCount = 1
      mockLegendsFor();
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { UNKNOWN: 100, ...computedExtras },
      };
      await service.create(payload as never, stateClient).catch(() => {});
      expect(mockAuditLogService.logValidationFailed).toHaveBeenCalledWith(expect.objectContaining({ errorCount: 1 }));
    });

    it('logValidationFailed includes validationSummary with errors array', async () => {
      mockLegendsFor();
      // UNKNOWN + '120' + '210' = 3 keys → lineItemCount = 3; errorCount = 1 (UNKNOWN only)
      const payload = {
        ulbCode: validUlbCode,
        yearCode: validYearCode,
        lineItems: { UNKNOWN: 100, ...computedExtras },
      };
      await service.create(payload as never, stateClient).catch(() => {});
      const arg = (mockAuditLogService.logValidationFailed.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      const summary = arg['validationSummary'] as Record<string, unknown>;
      expect(Array.isArray(summary['errors'])).toBe(true);
      expect(arg['lineItemCount']).toBe(3);
      expectNoRemovedAuditFields(arg);
      expect(arg).not.toHaveProperty('lineItems');
    });

    it('calls logSubmitted on successful submission', async () => {
      mockLegendsFor();
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      // lineItemCount = Object.keys(payload.lineItems).length
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };
      await service.create(payload as never, stateClient);
      const arg = (mockAuditLogService.logSubmitted.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg).toEqual(
        expect.objectContaining({
          apiClientId: expect.any(Types.ObjectId) as Types.ObjectId,
          stateId: new Types.ObjectId(validStateId),
          ulbId: new Types.ObjectId(validUlbId),
          yearId: new Types.ObjectId(validYearId),
          templateVersion: '2026.1',
          lineItemCount: 3,
          validationStatus: 'VALID',
        }),
      );
      expectNoRemovedAuditFields(arg);
    });

    it('passes ip and userAgent from meta to audit log', async () => {
      mockLegendsFor();
      mockSave.mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) }));
      const payload = { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, ...computedExtras } };
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

    it('loads legends for the existing record templateVersion, not DEFAULT_TEMPLATE_VERSION, when payload omits templateVersion', async () => {
      const existingDoc = {
        templateVersion: '2025.2',
        lineItems: new Map<string, number>([['110', 1000]]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ templateVersion: '2025.2' })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('110')]);

      await service.update(basePayload as never, stateClient).catch(() => {});

      expect(mockLineItemsLegendService.getActiveLegendsForValidation).toHaveBeenCalledWith('2025.2');
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
        lineItems: new Map<string, number>([
          ['110', 500],
          ['120', 1],
          ['210', 1],
        ]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLegendsFor();

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
        // Pre-include '210': 1 so merged result satisfies totExpenditure > 0
        lineItems: new Map<string, number>([
          ['11001', 600],
          ['210', 1],
        ]),
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
      mockLegendsFor([
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
        lineItems: new Map<string, number>([
          ['110', 500],
          ['120', 1],
          ['210', 1],
        ]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLegendsFor();

      await service.update(basePayload as never, stateClient);
      expect(existingDoc.stateId).toEqual(new Types.ObjectId(validStateId));
    });

    it('backfills yearCode when missing from an older record', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: undefined as unknown as string,
        lineItems: new Map<string, number>([
          ['110', 500],
          ['120', 1],
          ['210', 1],
        ]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLegendsFor();

      await service.update(basePayload as never, stateClient);
      expect(existingDoc.yearCode).toBe(validYearCode);
    });

    it('response includes ulbCode and yearCode', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>([
          ['120', 1],
          ['210', 1],
        ]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLegendsFor();

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
        lineItems: new Map<string, number>([
          ['120', 1],
          ['210', 1],
        ]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLegendsFor();

      const result = (await service.update(basePayload as never, stateClient)) as Record<string, unknown>;
      const data = result['data'] as Record<string, unknown>;
      expect(data).not.toHaveProperty('_id');
      expect(data).not.toHaveProperty('ulbId');
      expect(data).not.toHaveProperty('stateId');
      expect(data).not.toHaveProperty('yearId');
      expect(data).not.toHaveProperty('__v');
      expect(data).not.toHaveProperty('apiClientId');
    });

    it('does not overwrite the original apiClientId on modify', async () => {
      const originalApiClientId = new Types.ObjectId();
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>([
          ['120', 1],
          ['210', 1],
        ]),
        apiClientId: originalApiClientId,
        save: jest.fn().mockResolvedValue(makeDocSaveResult()),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLegendsFor();
      await service.update(basePayload as never, stateClient);
      expect(existingDoc.apiClientId).toBe(originalApiClientId);
    });

    it('modify success audit log includes dataCollectionId', async () => {
      const savedId = new Types.ObjectId();
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>([
          ['120', 1],
          ['210', 1],
        ]),
        save: jest.fn().mockResolvedValue({ ...makeDocSaveResult(), _id: savedId }),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLegendsFor();
      await service.update(basePayload as never, stateClient);
      expect(mockAuditLogService.logModified).toHaveBeenCalledWith(
        expect.objectContaining({ dataCollectionId: savedId }),
      );
    });

    it('response message says Financial data updated successfully', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>([
          ['120', 1],
          ['210', 1],
        ]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLegendsFor();

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
        // Pre-include computed-passing codes so merged result satisfies computed validation
        lineItems: new Map<string, number>([
          ['120', 1],
          ['210', 1],
        ]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLegendsFor();
      // basePayload lineItems: { '110': 500 } → lineItemCount = 1, changedLineItemCodes = ['110'] (not in existing)
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
        lineItems: new Map<string, number>([
          ['110', 999],
          ['120', 1],
          ['210', 1],
        ]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLegendsFor();
      await service.update(basePayload as never, stateClient);
      const arg = (mockAuditLogService.logModified.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['changedLineItemCodes']).toContain('110');
    });

    it('changedLineItemCodes omits keys whose values are unchanged', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>([
          ['110', 500],
          ['120', 1],
          ['210', 1],
        ]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLegendsFor();
      await service.update(basePayload as never, stateClient);
      const arg = (mockAuditLogService.logModified.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['changedLineItemCodes']).toEqual([]);
    });

    it('does not pass full merged lineItems to logModified', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>([
          ['120', 1],
          ['210', 1],
        ]),
        save: jest.fn().mockResolvedValue(makeDocSaveResult({ lineItems: new Map([['110', 500]]) })),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLegendsFor();
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

  // ─── formula: diff ────────────────────────────────────────────────────────

  describe('formula: diff', () => {
    const makeDiffRule = (operands: string[]) => ({ type: 'formula', operation: 'diff', operands });

    it('passes when parent equals A - B', async () => {
      mockLegendsFor([makeLegend('A'), makeLegend('B'), makeLegend('110', [makeDiffRule(['A', 'B'])] as never)]);
      const result = (await service.create(
        {
          ulbCode: validUlbCode,
          yearCode: validYearCode,
          lineItems: { '110': 300, A: 500, B: 200, ...computedExtras },
        } as never,
        stateClient,
      )) as Record<string, unknown>;
      expect((result['data'] as Record<string, unknown>)['validationStatus']).toBe('VALID');
    });

    it('passes when parent equals A - B - C', async () => {
      mockLegendsFor([
        makeLegend('A'),
        makeLegend('B'),
        makeLegend('C'),
        makeLegend('110', [makeDiffRule(['A', 'B', 'C'])] as never),
      ]);
      const result = (await service.create(
        {
          ulbCode: validUlbCode,
          yearCode: validYearCode,
          lineItems: { '110': 100, A: 500, B: 200, C: 200, ...computedExtras },
        } as never,
        stateClient,
      )) as Record<string, unknown>;
      expect((result['data'] as Record<string, unknown>)['validationStatus']).toBe('VALID');
    });

    it('fails when parent does not equal diff of submitted operands', async () => {
      const legends = [makeLegend('A'), makeLegend('B'), makeLegend('110', [makeDiffRule(['A', 'B'])] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create(
          { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 999, A: 500, B: 200 } } as never,
          stateClient,
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('must equal diff of submitted operands');
      expect(body.errors[0].expected).toBe(300);
      expect(body.errors[0].received).toBe(999);
    });

    it('sparse: skips missing operand and validates with remaining', async () => {
      mockLegendsFor([
        makeLegend('A'),
        makeLegend('B'),
        makeLegend('C'),
        makeLegend('110', [makeDiffRule(['A', 'B', 'C'])] as never),
      ]);
      // C not submitted; expected = A - B = 300
      const result = (await service.create(
        {
          ulbCode: validUlbCode,
          yearCode: validYearCode,
          lineItems: { '110': 300, A: 500, B: 200, ...computedExtras },
        } as never,
        stateClient,
      )) as Record<string, unknown>;
      expect((result['data'] as Record<string, unknown>)['validationStatus']).toBe('VALID');
    });

    it('fails when no operands are submitted', async () => {
      const legends = [makeLegend('A'), makeLegend('B'), makeLegend('110', [makeDiffRule(['A', 'B'])] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create({ ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 300 } } as never, stateClient)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('cannot be validated because none of its operands were submitted');
    });

    it('fails when only one operand is submitted', async () => {
      const legends = [makeLegend('A'), makeLegend('B'), makeLegend('110', [makeDiffRule(['A', 'B'])] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create(
          { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, A: 500 } } as never,
          stateClient,
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('diff rule requires at least 2 submitted operands');
    });

    it('fails when a referenced operand is not in the template', async () => {
      const legends = [makeLegend('A'), makeLegend('110', [makeDiffRule(['A', 'GHOST'])] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create(
          { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, A: 500 } } as never,
          stateClient,
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('refers to unknown operand GHOST');
    });

    it('explicit 0 counts as a submitted operand', async () => {
      mockLegendsFor([makeLegend('A'), makeLegend('B'), makeLegend('110', [makeDiffRule(['A', 'B'])] as never)]);
      const result = (await service.create(
        {
          ulbCode: validUlbCode,
          yearCode: validYearCode,
          lineItems: { '110': 0, A: 0, B: 0, ...computedExtras },
        } as never,
        stateClient,
      )) as Record<string, unknown>;
      expect((result['data'] as Record<string, unknown>)['validationStatus']).toBe('VALID');
    });
  });

  // ─── formula: linear ──────────────────────────────────────────────────────

  describe('formula: linear', () => {
    const makeLinearRule = (operands: { code: string; sign: 1 | -1 }[]) => ({
      type: 'formula',
      operation: 'linear',
      operands,
    });

    it('passes for A + B - C', async () => {
      const rule = makeLinearRule([
        { code: 'A', sign: 1 },
        { code: 'B', sign: 1 },
        { code: 'C', sign: -1 },
      ]);
      mockLegendsFor([makeLegend('A'), makeLegend('B'), makeLegend('C'), makeLegend('110', [rule] as never)]);
      // 500 + 300 - 100 = 700
      const result = (await service.create(
        {
          ulbCode: validUlbCode,
          yearCode: validYearCode,
          lineItems: { '110': 700, A: 500, B: 300, C: 100, ...computedExtras },
        } as never,
        stateClient,
      )) as Record<string, unknown>;
      expect((result['data'] as Record<string, unknown>)['validationStatus']).toBe('VALID');
    });

    it('passes for A - B + C', async () => {
      const rule = makeLinearRule([
        { code: 'A', sign: 1 },
        { code: 'B', sign: -1 },
        { code: 'C', sign: 1 },
      ]);
      mockLegendsFor([makeLegend('A'), makeLegend('B'), makeLegend('C'), makeLegend('110', [rule] as never)]);
      // 500 - 200 + 100 = 400
      const result = (await service.create(
        {
          ulbCode: validUlbCode,
          yearCode: validYearCode,
          lineItems: { '110': 400, A: 500, B: 200, C: 100, ...computedExtras },
        } as never,
        stateClient,
      )) as Record<string, unknown>;
      expect((result['data'] as Record<string, unknown>)['validationStatus']).toBe('VALID');
    });

    it('fails when parent does not equal the linear combination', async () => {
      const rule = makeLinearRule([
        { code: 'A', sign: 1 },
        { code: 'B', sign: -1 },
      ]);
      const legends = [makeLegend('A'), makeLegend('B'), makeLegend('110', [rule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create(
          { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 999, A: 500, B: 200 } } as never,
          stateClient,
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('must equal linear combination');
      expect(body.errors[0].expected).toBe(300);
      expect(body.errors[0].received).toBe(999);
    });

    it('sparse: skips missing operands and validates with remaining', async () => {
      const rule = makeLinearRule([
        { code: 'A', sign: 1 },
        { code: 'B', sign: -1 },
        { code: 'C', sign: 1 },
      ]);
      mockLegendsFor([makeLegend('A'), makeLegend('B'), makeLegend('C'), makeLegend('110', [rule] as never)]);
      // C not submitted; expected = A - B = 300
      const result = (await service.create(
        {
          ulbCode: validUlbCode,
          yearCode: validYearCode,
          lineItems: { '110': 300, A: 500, B: 200, ...computedExtras },
        } as never,
        stateClient,
      )) as Record<string, unknown>;
      expect((result['data'] as Record<string, unknown>)['validationStatus']).toBe('VALID');
    });

    it('fails when no operands are submitted', async () => {
      const rule = makeLinearRule([
        { code: 'A', sign: 1 },
        { code: 'B', sign: -1 },
      ]);
      const legends = [makeLegend('A'), makeLegend('B'), makeLegend('110', [rule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create({ ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 300 } } as never, stateClient)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('cannot be validated because none of its operands were submitted');
    });

    it('fails when a referenced operand code is not in the template', async () => {
      const rule = makeLinearRule([
        { code: 'A', sign: 1 },
        { code: 'GHOST', sign: -1 },
      ]);
      const legends = [makeLegend('A'), makeLegend('110', [rule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create(
          { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, A: 500 } } as never,
          stateClient,
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('refers to unknown operand GHOST');
    });

    it('fails when an operand has an invalid sign', async () => {
      const rule = { type: 'formula', operation: 'linear', operands: [{ code: 'A', sign: 99 }] };
      const legends = [makeLegend('A'), makeLegend('110', [rule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create(
          { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 500, A: 500 } } as never,
          stateClient,
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('invalid operand shape');
    });

    it('explicit 0 counts as a submitted operand', async () => {
      const rule = makeLinearRule([
        { code: 'A', sign: 1 },
        { code: 'B', sign: -1 },
      ]);
      mockLegendsFor([makeLegend('A'), makeLegend('B'), makeLegend('110', [rule] as never)]);
      const result = (await service.create(
        {
          ulbCode: validUlbCode,
          yearCode: validYearCode,
          lineItems: { '110': 0, A: 0, B: 0, ...computedExtras },
        } as never,
        stateClient,
      )) as Record<string, unknown>;
      expect((result['data'] as Record<string, unknown>)['validationStatus']).toBe('VALID');
    });
  });

  // ─── comparison rules ─────────────────────────────────────────────────────

  describe('comparison rules', () => {
    const makeCompRule = (operator: string, value: number) => ({ type: 'comparison', operator, value });

    const runComparison = async (operator: string, threshold: number, submitted: number) => {
      const rule = makeCompRule(operator, threshold);
      mockLegendsFor([makeLegend('110', [rule] as never)]);
      return service
        .create(
          {
            ulbCode: validUlbCode,
            yearCode: validYearCode,
            lineItems: { '110': submitted, ...computedExtras },
          } as never,
          stateClient,
        )
        .catch((e: unknown) => e);
    };

    it('> passes when value satisfies the operator', async () => {
      const result = await runComparison('>', 0, 100);
      expect(result).not.toBeInstanceOf(BadRequestException);
    });

    it('> fails when value does not satisfy the operator', async () => {
      const result = await runComparison('>', 100, 0);
      expect(result).toBeInstanceOf(BadRequestException);
      const body = (result as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('must be > 100');
    });

    it('>= passes and fails correctly', async () => {
      expect(await runComparison('>=', 100, 100)).not.toBeInstanceOf(BadRequestException);
      expect(await runComparison('>=', 100, 99)).toBeInstanceOf(BadRequestException);
    });

    it('< passes and fails correctly', async () => {
      expect(await runComparison('<', 100, 50)).not.toBeInstanceOf(BadRequestException);
      expect(await runComparison('<', 100, 100)).toBeInstanceOf(BadRequestException);
    });

    it('<= passes and fails correctly', async () => {
      expect(await runComparison('<=', 100, 100)).not.toBeInstanceOf(BadRequestException);
      expect(await runComparison('<=', 100, 101)).toBeInstanceOf(BadRequestException);
    });

    it('=== passes and fails correctly', async () => {
      expect(await runComparison('===', 42, 42)).not.toBeInstanceOf(BadRequestException);
      expect(await runComparison('===', 42, 43)).toBeInstanceOf(BadRequestException);
    });

    it('!== passes and fails correctly', async () => {
      expect(await runComparison('!==', 0, 1)).not.toBeInstanceOf(BadRequestException);
      expect(await runComparison('!==', 0, 0)).toBeInstanceOf(BadRequestException);
    });

    it('comparison rule is NOT silently skipped', async () => {
      const result = await runComparison('>', 100, 0);
      expect(result).toBeInstanceOf(BadRequestException);
      const body = (result as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors.some((e) => e.validationRule?.type === 'comparison')).toBe(true);
    });

    it('invalid value does not create a duplicate comparison error', async () => {
      const rule = makeCompRule('>', 0);
      mockLegendsFor([makeLegend('110', [rule] as never)]);
      const err = await service
        .create(
          { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 'bad', ...computedExtras } } as never,
          stateClient,
        )
        .catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      // Exactly one error for '110': the invalid value error — no duplicate comparison error
      const errorsFor110 = body.errors.filter((e) => e.lineItemCode === '110');
      expect(errorsFor110).toHaveLength(1);
      expect(errorsFor110[0].message).toContain('must be a finite number');
    });

    it('comparison error uses expectedCondition, not numeric expected', async () => {
      const result = await runComparison('>=', 500, 100);
      const body = (result as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].expectedCondition).toBe('>= 500');
      expect(body.errors[0].received).toBe(100);
      expect(body.errors[0]).not.toHaveProperty('expected');
    });

    it('!== 0 failure returns expectedCondition "!== 0" and no numeric expected', async () => {
      const result = await runComparison('!==', 0, 0);
      const body = (result as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].expectedCondition).toBe('!== 0');
      expect(body.errors[0].received).toBe(0);
      expect(body.errors[0]).not.toHaveProperty('expected');
    });

    it('> 0 failure returns expectedCondition "> 0" and no numeric expected', async () => {
      const result = await runComparison('>', 0, 0);
      const body = (result as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].expectedCondition).toBe('> 0');
      expect(body.errors[0].received).toBe(0);
      expect(body.errors[0]).not.toHaveProperty('expected');
    });

    it('>= 0 failure with value -1 returns expectedCondition ">= 0" and received -1', async () => {
      const result = await runComparison('>=', 0, -1);
      const body = (result as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].expectedCondition).toBe('>= 0');
      expect(body.errors[0].received).toBe(-1);
      expect(body.errors[0]).not.toHaveProperty('expected');
    });
  });

  // ─── computed key rejection ───────────────────────────────────────────────

  describe('computed key rejection', () => {
    it('rejects submitted computed.* key with a clear error', async () => {
      const legends = [makeLegend('110'), makeComputedLegend('computed.totalIncome', [] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create(
          {
            ulbCode: validUlbCode,
            yearCode: validYearCode,
            lineItems: { 'computed.totalIncome': 100, '110': 500 },
          } as never,
          stateClient,
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const computedErr = body.errors.find((e) => e.lineItemCode === 'computed.totalIncome');
      expect(computedErr).toBeDefined();
      expect(computedErr?.message).toContain('cannot be submitted in lineItems');
    });
  });

  // ─── direct comparison rules — mandatory when present ─────────────────────

  describe('direct comparison rules — mandatory when present', () => {
    it('fails with clear error when code with comparison rule is not submitted', async () => {
      const rule = { type: 'comparison', operator: '>', value: 0 };
      const legends = [makeLegend('110', [rule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create({ ulbCode: validUlbCode, yearCode: validYearCode, lineItems: {} } as never, stateClient)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].lineItemCode).toBe('110');
      expect(body.errors[0].message).toContain('cannot be validated because the line item was not submitted');
    });

    it('passes when submitted value satisfies the comparison rule', async () => {
      const rule = { type: 'comparison', operator: '>', value: 0 };
      mockLegendsFor([makeLegend('110', [rule] as never)]);
      const result = await service
        .create(
          { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 100, ...computedExtras } } as never,
          stateClient,
        )
        .catch((e: unknown) => e);
      expect(result).not.toBeInstanceOf(BadRequestException);
    });

    it('invalid submitted value does not create a duplicate not-submitted error', async () => {
      const rule = { type: 'comparison', operator: '>', value: 0 };
      mockLegendsFor([makeLegend('110', [rule] as never)]);
      const err = await service
        .create(
          { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 'bad', ...computedExtras } } as never,
          stateClient,
        )
        .catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      // Exactly one error for '110': the invalid value error — no duplicate "not submitted" error
      const errorsFor110 = body.errors.filter((e) => e.lineItemCode === '110');
      expect(errorsFor110).toHaveLength(1);
      expect(errorsFor110[0].message).toContain('must be a finite number');
    });
  });

  // ─── computed totals (config-based) ──────────────────────────────────────

  describe('computed totals', () => {
    const baseComputedPayload = (lineItems: Record<string, unknown>) => ({
      ulbCode: validUlbCode,
      yearCode: validYearCode,
      lineItems,
    });

    it('submit stores computed from DB computed legends', async () => {
      // makeFullLegendSet includes source code legends + computed legends with isComputed: true
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(makeFullLegendSet());
      await service.create(baseComputedPayload({ '110': 500, '210': 300 }) as never, stateClient);
      const modelCallArg = (dcModel.mock.calls[0] as unknown[][])[0] as unknown as Record<string, unknown>;
      expect(modelCallArg['computed']).toMatchObject({
        totIncome: 500, // only '110' submitted from income codes
        totExpenditure: 300, // only '210' submitted from expenditure codes
        totRevenue: 500, // same source codes as income
        totOwnRevenue: 500, // '110' is in ownRevenue codes
      });
    });

    it('computed is NOT stored inside lineItems', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(makeFullLegendSet());
      await service.create(baseComputedPayload({ '110': 100, '210': 200 }) as never, stateClient);
      const modelCallArg = (dcModel.mock.calls[0] as unknown[][])[0] as unknown as Record<string, unknown>;
      const storedKeys = Object.keys(modelCallArg['lineItems'] as Record<string, unknown>);
      expect(storedKeys.some((k) => k.startsWith('computed.'))).toBe(false);
      expect(storedKeys).toContain('110');
    });

    it('modify recomputes computed from DB computed legends using merged line items', async () => {
      const existingDoc = {
        templateVersion: '2026.1',
        stateId: new Types.ObjectId(validStateId),
        yearCode: validYearCode,
        lineItems: new Map<string, number>([['110', 300]]),
        computed: { totIncome: 0, totExpenditure: 0, totRevenue: 0, totOwnRevenue: 0 },
        save: jest.fn().mockResolvedValue(
          makeDocSaveResult({
            lineItems: new Map([
              ['110', 300],
              ['210', 400],
            ]),
          }),
        ),
      };
      dcModel.findOne.mockReturnValue(existingDoc);
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(makeFullLegendSet());

      await service.update(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '210': 400 } } as never,
        stateClient,
      );

      // After merge: { '110': 300, '210': 400 }
      expect(existingDoc.computed).toEqual({
        totIncome: 300,
        totExpenditure: 400,
        totRevenue: 300,
        totOwnRevenue: 300,
      });
    });

    it('missing source line item contributes 0 to the computed total', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(makeFullLegendSet());
      await service.create(baseComputedPayload({ '110': 400, '210': 200 }) as never, stateClient);
      const modelCallArg = (dcModel.mock.calls[0] as unknown[][])[0] as unknown as Record<string, unknown>;
      const computed = modelCallArg['computed'] as Record<string, number>;
      // '120', '130' … not submitted → contribute 0; totIncome = 400 only from '110'
      expect(computed.totIncome).toBe(400);
      // '220', '230' … not submitted → totExpenditure = 200 only from '210'
      expect(computed.totExpenditure).toBe(200);
    });

    it('submitted code not in template is rejected as unknown regardless of computed config', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([makeLegend('999')]);
      const err = await service
        .create(baseComputedPayload({ '110': 100 }) as never, stateClient)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].lineItemCode).toBe('110');
      expect(body.errors[0].message).toContain('does not exist in template version');
    });

    it('totIncome fails when computed value equals 0 (!== 0 from DB rule)', async () => {
      // Only expenditure submitted → income source codes contribute 0 → totIncome = 0 → fails
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(makeFullLegendSet());
      const err = await service
        .create(baseComputedPayload({ '210': 500 }) as never, stateClient)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors.find((e) => e.lineItemCode === 'computed.totIncome');
      expect(issue).toBeDefined();
      expect(issue?.expectedCondition).toBe('!== 0');
      expect(issue?.received).toBe(0);
    });

    it('totExpenditure fails when computed value is 0 (> 0 from DB rule)', async () => {
      // Only income submitted → no expenditure codes → totExpenditure = 0 → fails
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(makeFullLegendSet());
      const err = await service
        .create(baseComputedPayload({ '110': 500 }) as never, stateClient)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors.find((e) => e.lineItemCode === 'computed.totExpenditure');
      expect(issue).toBeDefined();
      expect(issue?.expectedCondition).toBe('> 0');
      expect(issue?.received).toBe(0);
    });

    it('totRevenue fails when computed value is 0 (> 0 from DB rule)', async () => {
      // Only expenditure submitted → revenue uses income codes, all 0 → fails
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(makeFullLegendSet());
      const err = await service
        .create(baseComputedPayload({ '210': 500 }) as never, stateClient)
        .catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors.find((e) => e.lineItemCode === 'computed.totRevenue');
      expect(issue).toBeDefined();
      expect(issue?.expectedCondition).toBe('> 0');
      expect(issue?.received).toBe(0);
    });

    it('totOwnRevenue fails when computed value is negative (>= 0 from DB rule)', async () => {
      // '110' is in ownRevenue source codes; negative value → totOwnRevenue < 0
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(makeFullLegendSet());
      const err = await service
        .create(baseComputedPayload({ '110': -100, '210': 500 }) as never, stateClient)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors.find((e) => e.lineItemCode === 'computed.totOwnRevenue');
      expect(issue).toBeDefined();
      expect(issue?.expectedCondition).toBe('>= 0');
      expect(issue?.received).toBe(-100);
    });

    it('computed validation error carries expectedCondition not a numeric expected field', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(makeFullLegendSet());
      const err = await service
        .create(baseComputedPayload({ '210': 500 }) as never, stateClient)
        .catch((e: unknown) => e);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      const issue = body.errors.find((e) => e.lineItemCode === 'computed.totIncome');
      expect(issue).toBeDefined();
      expect(issue).not.toHaveProperty('expected');
      expect(issue?.expectedCondition).toBeDefined();
    });

    it('no computed validation runs when no computed legends are in the active template', async () => {
      // makeComputedSourceLegends() has no isComputed: true legends → no computed validation
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(makeComputedSourceLegends());
      const result = await service.create(baseComputedPayload({ '110': 100 }) as never, stateClient);
      expect(result).not.toBeInstanceOf(BadRequestException);
    });

    it('computed validation passes when all four totals satisfy DB comparison rules', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(makeFullLegendSet());
      const result = await service.create(baseComputedPayload({ '110': 100, '210': 200 }) as never, stateClient);
      expect(result).not.toBeInstanceOf(BadRequestException);
    });

    it('client-submitted computed.* key in lineItems is rejected regardless of DB legends', async () => {
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(makeFullLegendSet());
      const err = await service
        .create(baseComputedPayload({ 'computed.totIncome': 100, '110': 50, '210': 50 }) as never, stateClient)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(
        body.errors.some((e) => e.lineItemCode === 'computed.totIncome' && e.message.includes('cannot be submitted')),
      ).toBe(true);
    });
  });

  // ─── Parallelization: ULB + year concurrent resolution ───────────────────

  describe('ULB and year resolution — concurrent execution', () => {
    /** Builds deferred promises so tests can control resolution order explicitly. */
    function makeDeferred<T>() {
      let resolve!: (value: T) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it('both resolver promises are started before either one settles', async () => {
      const ulbDeferred = makeDeferred<{ ulbId: Types.ObjectId; stateId: Types.ObjectId }>();
      const yearDeferred = makeDeferred<{ yearId: Types.ObjectId; yearCode: string }>();

      const startOrder: string[] = [];
      mockReferenceResolverService.resolveUlbByCode.mockImplementationOnce(() => {
        startOrder.push('ulb');
        return ulbDeferred.promise;
      });
      mockReferenceResolverService.resolveYearByCode.mockImplementationOnce(() => {
        startOrder.push('year');
        return yearDeferred.promise;
      });

      // Start the call but do not await — we inspect concurrency before it resolves.
      const createPromise = service
        .create({ ulbCode: validUlbCode, yearCode: validYearCode, lineItems: {} } as never, stateClient)
        .catch(() => undefined);

      // Yield to the event loop so the service body has started executing.
      await Promise.resolve();
      await Promise.resolve();

      // Both resolvers must have been called before either settled.
      expect(startOrder).toEqual(['ulb', 'year']);

      // Settle so the test cleans up.
      ulbDeferred.resolve({ ulbId: new Types.ObjectId(validUlbId), stateId: new Types.ObjectId(validStateId) });
      yearDeferred.resolve({ yearId: new Types.ObjectId(validYearId), yearCode: validYearCode });
      await createPromise;
    });

    it('resolveUlbByCode and resolveYearByCode are called for create()', async () => {
      mockLegendsFor();
      await service.create(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { ...computedExtras } } as never,
        stateClient,
      );
      expect(mockReferenceResolverService.resolveUlbByCode).toHaveBeenCalledWith(validUlbCode);
      expect(mockReferenceResolverService.resolveYearByCode).toHaveBeenCalledWith(validYearCode);
    });

    it('resolveUlbByCode and resolveYearByCode are called for update()', async () => {
      mockLegendsFor();
      dcModel.findOne.mockReturnValueOnce(makeUpdateRecord());
      await service.update(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { ...computedExtras } } as never,
        stateClient,
      );
      expect(mockReferenceResolverService.resolveUlbByCode).toHaveBeenCalledWith(validUlbCode);
      expect(mockReferenceResolverService.resolveYearByCode).toHaveBeenCalledWith(validYearCode);
    });

    it('authorization runs after both resolutions in create() — auth receives the resolved ulbId', async () => {
      mockLegendsFor();
      await service.create(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { ...computedExtras } } as never,
        stateClient,
      );
      expect(mockAuthorizationService.validateCanSubmitForUlb).toHaveBeenCalledWith(
        stateClient,
        expect.stringMatching(/[0-9a-f]{24}/),
      );
    });

    it('authorization runs after both resolutions in update() — auth receives the resolved ulbId', async () => {
      mockLegendsFor();
      dcModel.findOne.mockReturnValueOnce(makeUpdateRecord());
      await service.update(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { ...computedExtras } } as never,
        stateClient,
      );
      expect(mockAuthorizationService.validateCanModifyForUlb).toHaveBeenCalledWith(
        stateClient,
        expect.stringMatching(/[0-9a-f]{24}/),
      );
    });

    it('ULB resolution failure prevents authorization and write in create()', async () => {
      mockReferenceResolverService.resolveUlbByCode.mockRejectedValueOnce(
        new NotFoundException("ULB with code 'BADCODE' not found."),
      );
      await expect(
        service.create({ ulbCode: 'BADCODE', yearCode: validYearCode, lineItems: {} } as never, stateClient),
      ).rejects.toThrow(NotFoundException);
      expect(mockAuthorizationService.validateCanSubmitForUlb).not.toHaveBeenCalled();
      expect(dcModel).not.toHaveBeenCalled();
    });

    it('year resolution failure prevents authorization and write in create()', async () => {
      mockReferenceResolverService.resolveYearByCode.mockRejectedValueOnce(
        new NotFoundException("Year 'BADYEAR' not found."),
      );
      await expect(
        service.create({ ulbCode: validUlbCode, yearCode: 'BADYEAR', lineItems: {} } as never, stateClient),
      ).rejects.toThrow(NotFoundException);
      expect(mockAuthorizationService.validateCanSubmitForUlb).not.toHaveBeenCalled();
      expect(dcModel).not.toHaveBeenCalled();
    });

    it('no write occurs before authorization succeeds in create()', async () => {
      mockAuthorizationService.validateCanSubmitForUlb.mockRejectedValueOnce(new Error('Forbidden'));
      await expect(
        service
          .create({ ulbCode: validUlbCode, yearCode: validYearCode, lineItems: {} } as never, stateClient)
          .catch((e) => e),
      ).resolves.toBeDefined();
      // dcModel as constructor must not have been called (no new DataCollection created).
      expect(dcModel).not.toHaveBeenCalled();
    });
  });

  // ─── Parallelization: duplicate check + legend loading concurrent ─────────

  describe('existing-submission lookup and legend loading — concurrent execution', () => {
    it('getActiveLegendsForValidation is called via the service boundary, not the model directly', async () => {
      mockLegendsFor();
      await service.create(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { ...computedExtras } } as never,
        stateClient,
      );
      expect(mockLineItemsLegendService.getActiveLegendsForValidation).toHaveBeenCalledTimes(1);
    });

    it('getActiveLegendsForValidation receives the correct templateVersion in create()', async () => {
      mockLegendsFor();
      await service.create(
        {
          ulbCode: validUlbCode,
          yearCode: validYearCode,
          templateVersion: '2026.1',
          lineItems: { ...computedExtras },
        } as never,
        stateClient,
      );
      expect(mockLineItemsLegendService.getActiveLegendsForValidation).toHaveBeenCalledWith('2026.1');
    });

    it('duplicate submission is still rejected via ConflictException when a record already exists', async () => {
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(makeReadRecord()));
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([]);
      await expect(
        service.create(
          { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: {} } as never,
          stateClient,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('duplicate audit log is still recorded before ConflictException is thrown', async () => {
      const existingRecord = makeReadRecord();
      dcModel.findOne.mockReturnValueOnce(makeFindOneLean(existingRecord));
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([]);
      await service.create({ ulbCode: validUlbCode, yearCode: validYearCode, lineItems: {} } as never, stateClient).catch(() => undefined);
      expect(mockAuditLogService.logDuplicateSubmit).toHaveBeenCalledTimes(1);
    });

    it('submit validation uses the legends loaded concurrently', async () => {
      const customLegend = makeLegend('999');
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce([
        ...makeComputedSourceLegends(),
        customLegend,
        ...makeAllComputedLegends(),
      ]);
      const result = await service.create(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { ...computedExtras } } as never,
        stateClient,
      );
      // Validation used the loaded legends and the submission succeeded.
      expect(result).toHaveProperty('message', 'Financial data submitted successfully.');
    });

    it('update validation uses the legends loaded concurrently', async () => {
      mockLegendsFor();
      dcModel.findOne.mockReturnValueOnce(makeUpdateRecord());
      const result = await service.update(
        { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { ...computedExtras } } as never,
        stateClient,
      );
      expect(result).toHaveProperty('message', 'Financial data updated successfully.');
      expect(mockLineItemsLegendService.getActiveLegendsForValidation).toHaveBeenCalledTimes(1);
    });
  });

  // ─── ULB schema indexes ───────────────────────────────────────────────────

  describe('ULB schema indexes', () => {
    type IndexTuple = [Record<string, unknown>, Record<string, unknown>];
    const ulbIndexes = () => UlbSchema.indexes() as IndexTuple[];

    it('UlbSchema declares a censusCode ascending index', () => {
      const idx = ulbIndexes().find(([key]) => 'censusCode' in key);
      expect(idx).toBeDefined();
      expect(idx?.[0]).toEqual({ censusCode: 1 });
    });

    it('UlbSchema declares an sbCode ascending index', () => {
      const idx = ulbIndexes().find(([key]) => 'sbCode' in key);
      expect(idx).toBeDefined();
      expect(idx?.[0]).toEqual({ sbCode: 1 });
    });

    it('censusCode index is not declared unique', () => {
      const idx = ulbIndexes().find(([key]) => 'censusCode' in key);
      expect(idx?.[1]['unique']).toBeFalsy();
    });

    it('sbCode index is not declared unique', () => {
      const idx = ulbIndexes().find(([key]) => 'sbCode' in key);
      expect(idx?.[1]['unique']).toBeFalsy();
    });
  });

  // ─── unsupported rules fail closed ────────────────────────────────────────

  describe('unsupported rules fail closed', () => {
    it('unsupported rule type returns error (not silent skip)', async () => {
      const rule = { type: 'unknown_type', operator: '>' };
      const legends = [makeLegend('110', [rule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create({ ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 100 } } as never, stateClient)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('unsupported rule type');
    });

    it('unsupported formula operation returns error', async () => {
      const rule = { type: 'formula', operation: 'product', operands: ['A', 'B'] };
      const legends = [makeLegend('A'), makeLegend('B'), makeLegend('110', [rule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create(
          { ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 100, A: 10, B: 10 } } as never,
          stateClient,
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('unsupported formula operation');
    });

    it('unsupported comparison operator returns error', async () => {
      const rule = { type: 'comparison', operator: '!=', value: 0 };
      const legends = [makeLegend('110', [rule] as never)];
      mockLineItemsLegendService.getActiveLegendsForValidation.mockResolvedValueOnce(legends);
      const err = await service
        .create({ ulbCode: validUlbCode, yearCode: validYearCode, lineItems: { '110': 100 } } as never, stateClient)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: DataCollectionValidationIssue[] };
      expect(body.errors[0].message).toContain('unsupported comparison operator');
    });
  });
});
