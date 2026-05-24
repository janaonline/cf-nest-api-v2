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

const mockTemplateResult = {
  templateVersion: '2026.1',
  accountHeads: ['INCOME', 'EXPENDITURE'],
  lineItems: [],
  codes: [],
};

const mockService = {
  getFinancialDataTemplate: jest.fn().mockResolvedValue(mockTemplateResult),
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

  it('getFinancialDataTemplate delegates to service with query', async () => {
    const query = { templateVersion: '2026.1' };
    await controller.getFinancialDataTemplate(query);
    expect(mockService.getFinancialDataTemplate).toHaveBeenCalledWith(query);
  });

  it('getFinancialDataTemplate returns templateVersion/accountHeads/lineItems/codes shape', async () => {
    const result = await controller.getFinancialDataTemplate({});
    expect(result).toHaveProperty('templateVersion');
    expect(result).toHaveProperty('accountHeads');
    expect(result).toHaveProperty('lineItems');
    expect(result).toHaveProperty('codes');
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
    const payload = { ulbCode: 'C001', yearCode: '2021-22', lineItems: { '110': 100 } };
    await controller.create(payload as never, mockClient);
    expect(mockService.create).toHaveBeenCalledWith(payload, mockClient);
  });

  it('update passes payload and client to service', async () => {
    const payload = { ulbCode: 'C001', yearCode: '2021-22', lineItems: { '110': 200 } };
    await controller.update(payload as never, mockClient);
    expect(mockService.update).toHaveBeenCalledWith(payload, mockClient);
  });
});
