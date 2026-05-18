import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { ApiClientContext } from 'src/module/auth/types/api-client-context.type';
import { Ulb } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';
import { DataCollection } from '../entities/data-collection.schema';
import { DataCollectionAuthorizationService } from './data-collection-authorization.service';
import { DataCollectionService } from './data-collection.service';

const mockDataCollectionModel = () => ({
  findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
});
const mockUlbModel = { find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) };
const mockYearModel = { find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) };
const mockAuthorizationService = {
  validateCanSubmitForUlb: jest.fn().mockResolvedValue(undefined),
  validateCanModifyForUlb: jest.fn().mockResolvedValue(undefined),
  getAllowedUlbFilter: jest.fn().mockReturnValue({ isActive: true }),
};

const stateClient: ApiClientContext = {
  apiClientId: 'aId',
  clientId: 'c1',
  actorType: 'STATE',
  stateId: '5dcf9d7216a06aed41c748dd',
  scopes: [],
};

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
      ],
    }).compile();

    service = module.get<DataCollectionService>(DataCollectionService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('getFinancialDataTemplate', () => {
    it('returns line items from constant (does not include cfCode as key)', () => {
      const result = service.getFinancialDataTemplate();
      expect(result).toHaveProperty('lineItems');
      expect(result).toHaveProperty('nmamCode');
      expect(result).not.toHaveProperty('cfCode');
    });
  });

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

  describe('create', () => {
    const payload = {
      ulbId: '5dd24729437ba31f7eb42eee',
      yearId: '606aafb14dff55e6c075d3ae',
      lineItems: {},
    };

    it('calls ownership validation before DB write', async () => {
      await service.create(payload as never, stateClient).catch(() => {});
      expect(mockAuthorizationService.validateCanSubmitForUlb).toHaveBeenCalledWith(stateClient, payload.ulbId);
    });

    it('throws ConflictException when data already exists', async () => {
      dcModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'existing' }) });

      await expect(service.create(payload as never, stateClient)).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when authorization fails', async () => {
      mockAuthorizationService.validateCanSubmitForUlb.mockRejectedValueOnce(
        new ForbiddenException('Client is not allowed to access this ULB.'),
      );

      await expect(service.create(payload as never, stateClient)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    const payload = {
      ulbId: '5dd24729437ba31f7eb42eee',
      yearId: '606aafb14dff55e6c075d3ae',
      lineItems: { '110': 500 },
    };

    it('calls ownership validation before DB write', async () => {
      dcModel.findOne.mockReturnValue({ lineItems: new Map(), save: jest.fn().mockResolvedValue({}) });
      await service.update(payload as never, stateClient).catch(() => {});
      expect(mockAuthorizationService.validateCanModifyForUlb).toHaveBeenCalledWith(stateClient, payload.ulbId);
    });

    it('throws NotFoundException when data does not exist', async () => {
      dcModel.findOne.mockReturnValue(null);
      await expect(service.update(payload as never, stateClient)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when authorization fails', async () => {
      mockAuthorizationService.validateCanModifyForUlb.mockRejectedValueOnce(
        new ForbiddenException('Client is not allowed to access this ULB.'),
      );

      await expect(service.update(payload as never, stateClient)).rejects.toThrow(ForbiddenException);
    });
  });
});
