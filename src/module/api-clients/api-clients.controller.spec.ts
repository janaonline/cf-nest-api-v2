import { Test, TestingModule } from '@nestjs/testing';
import type { User } from 'src/module/auth/enum/role.enum';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import type { SafeApiClientResponse } from './services/api-client.service';
import { ApiClientService } from './services/api-client.service';
import { ApiClientsController } from './api-clients.controller';
import type { CreateApiClientDto } from './dto/create-api-client.dto';
import { ListApiClientsQueryDto } from './dto/list-api-clients-query.dto';
import type { UpdateApiClientStatusDto } from './dto/update-api-client-status.dto';

const VALID_STATE_ID = '5dcf9d7216a06aed41c748dd';
const VALID_SCOPE = 'data_collection:template:read';

const fakeSafeClient: SafeApiClientResponse = {
  clientId: 'cf_state_abc123',
  actorType: 'STATE',
  stateId: VALID_STATE_ID,
  scopes: [VALID_SCOPE],
  allowedIps: [],
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const fakePaginated = {
  data: [fakeSafeClient],
  meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

const mockService = {
  createApiClient: jest.fn().mockResolvedValue({ ...fakeSafeClient, clientSecret: 'secret123' }),
  listApiClients: jest.fn().mockResolvedValue(fakePaginated),
  getApiClient: jest.fn().mockResolvedValue(fakeSafeClient),
  rotateSecret: jest
    .fn()
    .mockResolvedValue({ clientId: 'cf_state_abc123', clientSecret: 'newSecret', status: 'ACTIVE' }),
  updateStatus: jest.fn().mockResolvedValue({ ...fakeSafeClient, status: 'INACTIVE' }),
};

const mockUser: User = { _id: 'admin-id-123', email: 'admin@test.com', role: 'ADMIN' as never, ulb: '', state: '' };

describe('ApiClientsController', () => {
  let controller: ApiClientsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiClientsController],
      providers: [{ provide: ApiClientService, useValue: mockService }],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ApiClientsController>(ApiClientsController);
  });

  it('should be defined', () => expect(controller).toBeDefined());

  describe('create', () => {
    const dto: CreateApiClientDto = { actorType: 'STATE', stateId: VALID_STATE_ID, scopes: [VALID_SCOPE] };

    it('delegates to service.createApiClient with DTO, adminId, and metadata', async () => {
      await controller.create(dto, mockUser, '127.0.0.1', 'test-agent');
      expect(mockService.createApiClient).toHaveBeenCalledWith(dto, 'admin-id-123', {
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      });
    });

    it('response includes clientSecret', async () => {
      const result = await controller.create(dto, mockUser, '127.0.0.1');
      expect(result).toHaveProperty('clientSecret');
    });

    it('response does not include secretHash', async () => {
      const result = await controller.create(dto, mockUser, '127.0.0.1');
      expect(result).not.toHaveProperty('secretHash');
    });
  });

  describe('list', () => {
    it('delegates to service.listApiClients with query', async () => {
      const query = new ListApiClientsQueryDto();
      await controller.list(query);
      expect(mockService.listApiClients).toHaveBeenCalledWith(query);
    });

    it('returns paginated response with data and meta', async () => {
      const result = await controller.list(new ListApiClientsQueryDto());
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('returned data does not include secretHash', async () => {
      const result = await controller.list(new ListApiClientsQueryDto());
      result.data.forEach((item: Record<string, unknown>) => expect(item).not.toHaveProperty('secretHash'));
    });
  });

  describe('getOne', () => {
    it('passes clientId to service.getApiClient', async () => {
      await controller.getOne('cf_state_abc123');
      expect(mockService.getApiClient).toHaveBeenCalledWith('cf_state_abc123');
    });

    it('response does not include secretHash', async () => {
      expect(await controller.getOne('cf_state_abc123')).not.toHaveProperty('secretHash');
    });
  });

  describe('rotateSecret', () => {
    it('passes clientId, dto, adminId, and metadata to service', async () => {
      await controller.rotateSecret('cf_state_abc123', { reason: 'scheduled' }, mockUser, '127.0.0.1', 'agent');
      expect(mockService.rotateSecret).toHaveBeenCalledWith(
        'cf_state_abc123',
        { reason: 'scheduled' },
        'admin-id-123',
        { ip: '127.0.0.1', userAgent: 'agent' },
      );
    });

    it('response includes new clientSecret', async () => {
      const result = await controller.rotateSecret('cf_state_abc123', {}, mockUser, '127.0.0.1');
      expect(result).toHaveProperty('clientSecret');
    });

    it('response does not include secretHash', async () => {
      expect(await controller.rotateSecret('cf_state_abc123', {}, mockUser, '127.0.0.1')).not.toHaveProperty(
        'secretHash',
      );
    });
  });

  describe('updateStatus', () => {
    const dto: UpdateApiClientStatusDto = { status: 'INACTIVE', reason: 'temp disable' };

    it('passes clientId, status, adminId, metadata, and reason to service', async () => {
      await controller.updateStatus('cf_state_abc123', dto, mockUser, '127.0.0.1', 'agent');
      expect(mockService.updateStatus).toHaveBeenCalledWith(
        'cf_state_abc123',
        'INACTIVE',
        'admin-id-123',
        { ip: '127.0.0.1', userAgent: 'agent' },
        'temp disable',
      );
    });

    it('response reflects new status', async () => {
      const result = await controller.updateStatus('cf_state_abc123', { status: 'INACTIVE' }, mockUser, '127.0.0.1');
      expect(result.status).toBe('INACTIVE');
    });

    it('response does not include secretHash', async () => {
      expect(
        await controller.updateStatus('cf_state_abc123', { status: 'INACTIVE' }, mockUser, '127.0.0.1'),
      ).not.toHaveProperty('secretHash');
    });
  });
});
