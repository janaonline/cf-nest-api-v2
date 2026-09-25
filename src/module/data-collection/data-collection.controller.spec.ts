import { ApiOperation } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { SCOPES_KEY } from 'src/module/auth/decorators/scopes.decorator';
import { IntegrationJwtGuard } from 'src/module/auth/guards/integration-jwt.guard';
import { ScopesGuard } from 'src/module/auth/guards/scopes.guard';
import type { ApiClientContext } from 'src/module/auth/types/api-client-context.type';
import { DATA_COLLECTION_SCOPES } from './constant';
import { DataCollectionController } from './data-collection.controller';
import { GetDataCollectionDto } from './dto/get-data-collection.dto';
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
  findOneByUlbAndYear: jest.fn().mockResolvedValue({}),
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

  it('findOne passes query and client context to service', async () => {
    const query = { ulbCode: '802992', yearCode: '2024-25', templateVersion: '2026.1' };
    await controller.findOne(query, mockClient);
    expect(mockService.findOneByUlbAndYear).toHaveBeenCalledWith(query, mockClient);
  });

  it('findOne has financial data read scope metadata', () => {
    const descriptor = Object.getOwnPropertyDescriptor(DataCollectionController.prototype, 'findOne');
    const handler = descriptor?.value as unknown;
    expect(typeof handler).toBe('function');
    const scopes = Reflect.getMetadata(SCOPES_KEY, handler as object) as string[];
    expect(scopes).toEqual([DATA_COLLECTION_SCOPES.FINANCIAL_DATA_READ]);
  });

  it('GetDataCollectionDto accepts valid query params', async () => {
    const dto = Object.assign(new GetDataCollectionDto(), {
      ulbCode: '802992',
      yearCode: '2024-25',
      templateVersion: '2026.1',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('GetDataCollectionDto rejects empty and overlong query params', async () => {
    const dto = Object.assign(new GetDataCollectionDto(), {
      ulbCode: '',
      yearCode: '2'.repeat(21),
      templateVersion: 'v'.repeat(21),
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['ulbCode', 'yearCode', 'templateVersion']),
    );
  });

  it('create passes payload, client, and meta to service', async () => {
    const payload = { ulbCode: 'C001', yearCode: '2021-22', lineItems: { '110': 100 } };
    await controller.create(payload as never, mockClient, '1.2.3.4', 'TestAgent/1.0');
    expect(mockService.create).toHaveBeenCalledWith(payload, mockClient, { ip: '1.2.3.4', userAgent: 'TestAgent/1.0' });
  });

  it('create passes undefined userAgent when header is absent', async () => {
    const payload = { ulbCode: 'C001', yearCode: '2021-22', lineItems: { '110': 100 } };
    await controller.create(payload as never, mockClient, '1.2.3.4', undefined);
    expect(mockService.create).toHaveBeenCalledWith(payload, mockClient, { ip: '1.2.3.4', userAgent: undefined });
  });

  it('update passes payload, client, and meta to service', async () => {
    const payload = { ulbCode: 'C001', yearCode: '2021-22', lineItems: { '110': 200 } };
    await controller.update(payload as never, mockClient, '10.0.0.1', 'Mozilla/5.0');
    expect(mockService.update).toHaveBeenCalledWith(payload, mockClient, { ip: '10.0.0.1', userAgent: 'Mozilla/5.0' });
  });

  it('update passes undefined userAgent when header is absent', async () => {
    const payload = { ulbCode: 'C001', yearCode: '2021-22', lineItems: { '110': 200 } };
    await controller.update(payload as never, mockClient, '10.0.0.1', undefined);
    expect(mockService.update).toHaveBeenCalledWith(payload, mockClient, { ip: '10.0.0.1', userAgent: undefined });
  });
});
