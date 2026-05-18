import { ApiOperation } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationJwtGuard } from 'src/module/auth/guards/integration-jwt.guard';
import { ScopesGuard } from 'src/module/auth/guards/scopes.guard';
import type { ApiClientContext } from 'src/module/auth/types/api-client-context.type';
import { DataCollectionController } from './data-collection.controller';
import { DataCollectionService } from './services/data-collection.service';

const mockClient: ApiClientContext = {
  apiClientId: 'aId',
  clientId: 'c1',
  actorType: 'STATE',
  stateId: 'st1',
  scopes: ['data_collection:template:read', 'data_collection:ulbs:read', 'data_collection:years:read'],
};

const mockService = {
  getFinancialDataTemplate: jest.fn().mockReturnValue({ lineItems: [], nmamCode: [] }),
  getUlbsList: jest.fn().mockResolvedValue([]),
  getYearsList: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue({}),
};

describe('DataCollectionController', () => {
  let controller: DataCollectionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DataCollectionController],
      providers: [{ provide: DataCollectionService, useValue: mockService }],
    })
      .overrideGuard(IntegrationJwtGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ScopesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DataCollectionController>(DataCollectionController);
    jest.clearAllMocks();
  });

  it('should be defined', () => expect(controller).toBeDefined());

  it('ApiOperation import does not break build', () => expect(ApiOperation).toBeDefined());

  it('getFinancialDataTemplate delegates to service', () => {
    controller.getFinancialDataTemplate();
    expect(mockService.getFinancialDataTemplate).toHaveBeenCalled();
  });

  it('getUlbsList passes client context to service', async () => {
    await controller.getUlbsList(mockClient);
    expect(mockService.getUlbsList).toHaveBeenCalledWith(mockClient);
  });

  it('getYearsList delegates to service without client context', async () => {
    await controller.getYearsList();
    expect(mockService.getYearsList).toHaveBeenCalled();
  });

  it('create passes payload and client to service', async () => {
    const payload = { ulbId: 'ulb1', yearId: 'yr1', lineItems: { '110': 100 } };
    await controller.create(payload as never, mockClient);
    expect(mockService.create).toHaveBeenCalledWith(payload, mockClient);
  });

  it('update passes payload and client to service', async () => {
    const payload = { ulbId: 'ulb1', yearId: 'yr1', lineItems: { '110': 200 } };
    await controller.update(payload as never, mockClient);
    expect(mockService.update).toHaveBeenCalledWith(payload, mockClient);
  });
});
