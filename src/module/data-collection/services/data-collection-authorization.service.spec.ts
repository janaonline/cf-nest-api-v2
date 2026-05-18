import { ForbiddenException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { ApiClientContext } from 'src/module/auth/types/api-client-context.type';
import { Ulb } from 'src/schemas/ulb.schema';
import { DataCollectionAuthorizationService } from './data-collection-authorization.service';

const mockUlbModel = { exists: jest.fn() };

const stateClient: ApiClientContext = {
  apiClientId: 'aId',
  clientId: 'c1',
  actorType: 'STATE',
  stateId: '5dcf9d7216a06aed41c748dd',
  scopes: [],
};

const ulbClient: ApiClientContext = {
  apiClientId: 'aId',
  clientId: 'c2',
  actorType: 'ULB',
  stateId: '5dcf9d7216a06aed41c748dd',
  ulbId: '5dd24729437ba31f7eb42eee',
  scopes: [],
};

describe('DataCollectionAuthorizationService', () => {
  let service: DataCollectionAuthorizationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataCollectionAuthorizationService, { provide: getModelToken(Ulb.name), useValue: mockUlbModel }],
    }).compile();
    service = module.get<DataCollectionAuthorizationService>(DataCollectionAuthorizationService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('validateCanAccessUlb — ULB client', () => {
    it('allows ULB client to access their own ULB', async () => {
      await expect(service.validateCanAccessUlb(ulbClient, ulbClient.ulbId!)).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when ULB client accesses different ULB', async () => {
      await expect(service.validateCanAccessUlb(ulbClient, 'other-ulb-id')).rejects.toThrow(ForbiddenException);
    });

    it('does not call DB for ULB client ownership check', async () => {
      await service.validateCanAccessUlb(ulbClient, ulbClient.ulbId!).catch(() => {});
      expect(mockUlbModel.exists).not.toHaveBeenCalled();
    });
  });

  describe('validateCanAccessUlb — STATE client', () => {
    it('allows STATE client when ULB belongs to their state', async () => {
      mockUlbModel.exists.mockResolvedValue({ _id: 'someId' });
      await expect(service.validateCanAccessUlb(stateClient, '5dd24729437ba31f7eb42eee')).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when ULB not under client state', async () => {
      mockUlbModel.exists.mockResolvedValue(null);
      await expect(service.validateCanAccessUlb(stateClient, '5dd24729437ba31f7eb42eee')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('uses exists() not find() — single minimal DB call', async () => {
      mockUlbModel.exists.mockResolvedValue({ _id: 'id' });
      await service.validateCanAccessUlb(stateClient, '5dd24729437ba31f7eb42eee');
      expect(mockUlbModel.exists).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAllowedUlbFilter', () => {
    it('returns _id filter for ULB client', () => {
      const filter = service.getAllowedUlbFilter(ulbClient);
      expect(filter).toMatchObject({ isActive: true });
      expect(JSON.stringify(filter)).toContain(ulbClient.ulbId);
    });

    it('returns state filter for STATE client', () => {
      const filter = service.getAllowedUlbFilter(stateClient);
      expect(filter).toMatchObject({ isActive: true });
      expect(JSON.stringify(filter)).toContain(stateClient.stateId);
    });
  });

  describe('validateCanSubmitForUlb', () => {
    it('throws for disallowed ULB client', async () => {
      await expect(service.validateCanSubmitForUlb(ulbClient, 'wrong-id')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('validateCanModifyForUlb', () => {
    it('throws for disallowed ULB client', async () => {
      await expect(service.validateCanModifyForUlb(ulbClient, 'wrong-id')).rejects.toThrow(ForbiddenException);
    });
  });
});
