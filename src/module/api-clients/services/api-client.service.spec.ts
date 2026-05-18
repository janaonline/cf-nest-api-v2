import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { State } from 'src/schemas/state.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { CreateApiClientDto } from '../dto/create-api-client.dto';
import { ListApiClientsQueryDto } from '../dto/list-api-clients-query.dto';
import { ApiClient } from '../entities/api-client.schema';
import { ApiClientAuditLogService } from './api-client-audit-log.service';
import { ApiClientService } from './api-client.service';

const VALID_STATE_ID = '5dcf9d7216a06aed41c748dd';
const VALID_ULB_ID = '5dd24729437ba31f7eb42eee';
const VALID_SCOPE = 'data_collection:template:read';

const mockApiClientModel = () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
});

const mockStateModel = { exists: jest.fn() };
const mockUlbModel = { exists: jest.fn() };

const mockAuditLogService = {
  logClientCreated: jest.fn().mockResolvedValue(undefined),
  logSecretRotated: jest.fn().mockResolvedValue(undefined),
  logStatusUpdated: jest.fn().mockResolvedValue(undefined),
  logTokenCreated: jest.fn(),
  logTokenFailed: jest.fn(),
};

const mockConfig = {
  get: jest.fn().mockImplementation((key: string, defaultVal?: unknown) => {
    if (key === 'API_CLIENT_SECRET_SALT_ROUNDS') return 4;
    return defaultVal;
  }),
};

/** Builds a mock for the find() query chain: .select().sort().skip().limit().lean() */
function mockFindChain(resolvedValue: unknown) {
  const lean = jest.fn().mockResolvedValue(resolvedValue);
  const limit = jest.fn().mockReturnValue({ lean });
  const skip = jest.fn().mockReturnValue({ limit });
  const sort = jest.fn().mockReturnValue({ skip });
  const select = jest.fn().mockReturnValue({ sort });
  return { select };
}

describe('ApiClientService', () => {
  let service: ApiClientService;
  let model: ReturnType<typeof mockApiClientModel>;

  beforeEach(async () => {
    model = mockApiClientModel();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiClientService,
        { provide: getModelToken(ApiClient.name), useValue: model },
        { provide: getModelToken(State.name), useValue: mockStateModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: ConfigService, useValue: mockConfig },
        { provide: ApiClientAuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<ApiClientService>(ApiClientService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('findByClientIdWithSecret', () => {
    it('queries by trimmed clientId and selects +secretHash', async () => {
      const lean = jest.fn().mockResolvedValue(null);
      const select = jest.fn().mockReturnValue({ lean });
      model.findOne.mockReturnValue({ select });
      await service.findByClientIdWithSecret('  c1  ');
      expect(model.findOne).toHaveBeenCalledWith({ clientId: 'c1' });
      expect(select).toHaveBeenCalledWith('+secretHash');
    });
  });

  describe('findById', () => {
    it('does not request secretHash', async () => {
      const lean = jest.fn().mockResolvedValue({ clientId: 'c1' });
      const select = jest.fn().mockReturnValue({ lean });
      model.findById.mockReturnValue({ select });
      await service.findById('abc123');
      const selectArg = (select.mock.calls[0] as unknown[])[0] as string;
      expect(selectArg).not.toContain('secretHash');
    });
  });

  describe('verifySecret', () => {
    it('returns true for correct secret', async () => {
      const hash = await bcrypt.hash('mysecret', 4);
      expect(await service.verifySecret('mysecret', hash)).toBe(true);
    });
    it('returns false for wrong secret', async () => {
      const hash = await bcrypt.hash('mysecret', 4);
      expect(await service.verifySecret('wrong', hash)).toBe(false);
    });
  });

  describe('generateClientSecret', () => {
    it('returns 64-char hex string', () => {
      expect(service.generateClientSecret()).toMatch(/^[0-9a-f]{64}$/);
    });
    it('generates unique secrets on each call', () => {
      expect(service.generateClientSecret()).not.toBe(service.generateClientSecret());
    });
  });

  describe('touchLastUsed', () => {
    it('calls updateOne().exec() and does not throw', () => {
      const exec = jest.fn().mockResolvedValue({});
      model.updateOne.mockReturnValue({ exec });
      expect(() => service.touchLastUsed(new Types.ObjectId())).not.toThrow();
      expect(exec).toHaveBeenCalled();
    });
    it('uses $max operator to prevent lastUsedAt regression', () => {
      const exec = jest.fn().mockResolvedValue({});
      model.updateOne.mockReturnValue({ exec });
      service.touchLastUsed(new Types.ObjectId());
      const update = (model.updateOne.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect(update).toHaveProperty('$max');
    });
    it('silently catches DB errors without throwing', async () => {
      const exec = jest.fn().mockRejectedValue(new Error('DB error'));
      model.updateOne.mockReturnValue({ exec });
      service.touchLastUsed(new Types.ObjectId());
      await new Promise((r) => setTimeout(r, 20));
      expect(exec).toHaveBeenCalled();
    });
  });

  describe('validateScopes', () => {
    it('accepts valid data-collection scopes', () => {
      expect(() => service.validateScopes([VALID_SCOPE])).not.toThrow();
    });
    it('accepts all valid scopes together', () => {
      const all = [
        'data_collection:template:read',
        'data_collection:ulbs:read',
        'data_collection:years:read',
        'data_collection:financial_data:submit',
        'data_collection:financial_data:modify',
      ];
      expect(() => service.validateScopes(all)).not.toThrow();
    });
    it('throws BadRequestException for empty array', () => {
      expect(() => service.validateScopes([])).toThrow(BadRequestException);
    });
    it('throws BadRequestException for unknown scope', () => {
      expect(() => service.validateScopes(['unknown:scope'])).toThrow(BadRequestException);
    });
    it('throws BadRequestException for wildcard "*"', () => {
      expect(() => service.validateScopes(['*'])).toThrow(BadRequestException);
    });
    it('throws BadRequestException for "admin"', () => {
      expect(() => service.validateScopes(['admin'])).toThrow(BadRequestException);
    });
    it('error message lists each invalid scope', () => {
      try {
        service.validateScopes(['bad1', 'bad2']);
        fail('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('bad1');
        expect((e as Error).message).toContain('bad2');
      }
    });
  });

  describe('validateStateAndUlbReferences', () => {
    it('passes when state is active and actorType is STATE', async () => {
      mockStateModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });
      await expect(service.validateStateAndUlbReferences('STATE', VALID_STATE_ID)).resolves.toBeUndefined();
    });
    it('throws when state does not exist or is inactive', async () => {
      mockStateModel.exists.mockResolvedValue(null);
      await expect(service.validateStateAndUlbReferences('STATE', VALID_STATE_ID)).rejects.toThrow(BadRequestException);
    });
    it('passes when ULB exists and belongs to state', async () => {
      mockStateModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });
      mockUlbModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });
      await expect(service.validateStateAndUlbReferences('ULB', VALID_STATE_ID, VALID_ULB_ID)).resolves.toBeUndefined();
    });
    it('throws when ULB does not exist or is not in state', async () => {
      mockStateModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });
      mockUlbModel.exists.mockResolvedValue(null);
      await expect(service.validateStateAndUlbReferences('ULB', VALID_STATE_ID, VALID_ULB_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
    it('throws when ULB actor omits ulbId', async () => {
      mockStateModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });
      await expect(service.validateStateAndUlbReferences('ULB', VALID_STATE_ID)).rejects.toThrow(BadRequestException);
    });
  });

  describe('createApiClient', () => {
    const stateDto: CreateApiClientDto = { actorType: 'STATE', stateId: VALID_STATE_ID, scopes: [VALID_SCOPE] };
    const ulbDto: CreateApiClientDto = {
      actorType: 'ULB',
      stateId: VALID_STATE_ID,
      ulbId: VALID_ULB_ID,
      scopes: [VALID_SCOPE],
    };

    beforeEach(() => {
      mockStateModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });
      mockUlbModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });
      mockAuditLogService.logClientCreated.mockResolvedValue(undefined);
      model.create.mockImplementation((doc: Record<string, unknown>) =>
        Promise.resolve({
          ...doc,
          _id: new Types.ObjectId(),
          status: 'ACTIVE',
          allowedIps: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
    });

    it('creates STATE client without ulbId', async () => {
      const result = await service.createApiClient(stateDto);
      expect(result.actorType).toBe('STATE');
      expect(result.ulbId).toBeUndefined();
    });
    it('creates ULB client with ulbId', async () => {
      const result = await service.createApiClient(ulbDto);
      expect(result.actorType).toBe('ULB');
      expect(result.ulbId).toBe(VALID_ULB_ID);
    });
    it('throws when STATE client provides ulbId', async () => {
      await expect(service.createApiClient({ ...stateDto, ulbId: VALID_ULB_ID })).rejects.toThrow(BadRequestException);
    });
    it('throws when ULB client omits ulbId', async () => {
      await expect(
        service.createApiClient({ actorType: 'ULB', stateId: VALID_STATE_ID, scopes: [VALID_SCOPE] }),
      ).rejects.toThrow(BadRequestException);
    });
    it('throws for invalid scope', async () => {
      await expect(service.createApiClient({ ...stateDto, scopes: ['invalid:scope'] })).rejects.toThrow(
        BadRequestException,
      );
    });
    it('throws for empty scopes', async () => {
      await expect(service.createApiClient({ ...stateDto, scopes: [] })).rejects.toThrow(BadRequestException);
    });
    it('throws when state does not exist', async () => {
      mockStateModel.exists.mockResolvedValue(null);
      await expect(service.createApiClient(stateDto)).rejects.toThrow(BadRequestException);
    });
    it('throws when ULB does not belong to state', async () => {
      mockUlbModel.exists.mockResolvedValue(null);
      await expect(service.createApiClient(ulbDto)).rejects.toThrow(BadRequestException);
    });
    it('generates clientId in cf_state_* format', async () => {
      expect((await service.createApiClient(stateDto)).clientId).toMatch(/^cf_state_[0-9a-f]{16}$/);
    });
    it('generates clientId in cf_ulb_* format', async () => {
      expect((await service.createApiClient(ulbDto)).clientId).toMatch(/^cf_ulb_[0-9a-f]{16}$/);
    });
    it('returns plain clientSecret of at least 64 chars', async () => {
      expect((await service.createApiClient(stateDto)).clientSecret.length).toBeGreaterThanOrEqual(64);
    });
    it('does not include secretHash in response', async () => {
      expect(await service.createApiClient(stateDto)).not.toHaveProperty('secretHash');
    });
    it('stores secretHash not plain secret in DB', async () => {
      await service.createApiClient(stateDto);
      const stored = (model.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(stored['secretHash']).toBeDefined();
      expect(stored['secretHash']).not.toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    });
    it('sets createdBy and updatedBy when adminId provided', async () => {
      await service.createApiClient(stateDto, 'aaaaaaaaaaaaaaaaaaaaaaaa');
      const stored = (model.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(stored['createdBy']).toBeDefined();
      expect(stored['updatedBy']).toBeDefined();
    });
    it('calls logClientCreated without secrets in audit payload', async () => {
      await service.createApiClient(stateDto);
      expect(mockAuditLogService.logClientCreated).toHaveBeenCalledTimes(1);
      const arg = (mockAuditLogService.logClientCreated.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg).not.toHaveProperty('secretHash');
      expect(arg).not.toHaveProperty('clientSecret');
    });
  });

  describe('listApiClients', () => {
    const fakeClients = [
      {
        _id: new Types.ObjectId(),
        clientId: 'cf_state_abc',
        actorType: 'STATE' as const,
        stateId: new Types.ObjectId(VALID_STATE_ID),
        scopes: [VALID_SCOPE],
        allowedIps: [],
        status: 'ACTIVE' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    beforeEach(() => {
      model.find.mockReturnValue(mockFindChain(fakeClients));
      model.countDocuments.mockResolvedValue(1);
    });

    it('returns paginated response with data and meta', async () => {
      const result = await service.listApiClients();
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.meta).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });
    it('returns correct data items', async () => {
      const result = await service.listApiClients();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].clientId).toBe('cf_state_abc');
    });
    it('does not include secretHash in returned items', async () => {
      model.find.mockReturnValue(mockFindChain([{ ...fakeClients[0], secretHash: 'no' }]));
      expect((await service.listApiClients()).data[0]).not.toHaveProperty('secretHash');
    });
    it('filters by status', async () => {
      const q = new ListApiClientsQueryDto();
      q.status = 'ACTIVE';
      await service.listApiClients(q);
      expect((model.find.mock.calls[0] as unknown[])[0]).toMatchObject({ status: 'ACTIVE' });
    });
    it('filters by actorType', async () => {
      const q = new ListApiClientsQueryDto();
      q.actorType = 'STATE';
      await service.listApiClients(q);
      expect((model.find.mock.calls[0] as unknown[])[0]).toMatchObject({ actorType: 'STATE' });
    });
    it('adds $or regex when search provided', async () => {
      const q = new ListApiClientsQueryDto();
      q.search = 'cf_state';
      await service.listApiClients(q);
      expect((model.find.mock.calls[0] as unknown[])[0]).toHaveProperty('$or');
    });
    it('respects custom page and limit', async () => {
      model.countDocuments.mockResolvedValue(10);
      const q = new ListApiClientsQueryDto();
      q.page = 2;
      q.limit = 5;
      const result = await service.listApiClients(q);
      expect(result.meta).toMatchObject({ page: 2, limit: 5, totalPages: 2 });
    });
  });

  describe('getApiClient', () => {
    it('returns safe client when found', async () => {
      const fakeClient = {
        _id: new Types.ObjectId(),
        clientId: 'cf_state_abc',
        actorType: 'STATE' as const,
        stateId: new Types.ObjectId(VALID_STATE_ID),
        scopes: [],
        allowedIps: [],
        status: 'ACTIVE' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      model.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(fakeClient) }),
      });
      const result = await service.getApiClient('cf_state_abc');
      expect(result.clientId).toBe('cf_state_abc');
      expect(result).not.toHaveProperty('secretHash');
    });
    it('throws NotFoundException when client not found', async () => {
      model.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
      await expect(service.getApiClient('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('rotateSecret', () => {
    const snap = { _id: new Types.ObjectId(), status: 'ACTIVE' as const };

    beforeEach(() => {
      mockAuditLogService.logSecretRotated.mockResolvedValue(undefined);
      model.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(snap) }) });
      model.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    });

    it('throws NotFoundException when client not found', async () => {
      model.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
      await expect(service.rotateSecret('unknown')).rejects.toThrow(NotFoundException);
    });
    it('returns new plain clientSecret of at least 64 chars', async () => {
      expect((await service.rotateSecret('cf_state_abc')).clientSecret.length).toBeGreaterThanOrEqual(64);
    });
    it('does not include secretHash in response', async () => {
      expect(await service.rotateSecret('cf_state_abc')).not.toHaveProperty('secretHash');
    });
    it('returns the clientId and current status', async () => {
      const result = await service.rotateSecret('cf_state_abc');
      expect(result.clientId).toBe('cf_state_abc');
      expect(result.status).toBe('ACTIVE');
    });
    it('updates lastRotatedAt in DB', async () => {
      await service.rotateSecret('cf_state_abc');
      const update = (model.updateOne.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect((update['$set'] as Record<string, unknown>)['lastRotatedAt']).toBeDefined();
    });
    it('sets updatedBy when adminId is provided', async () => {
      await service.rotateSecret('cf_state_abc', undefined, 'aaaaaaaaaaaaaaaaaaaaaaaa');
      const update = (model.updateOne.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect((update['$set'] as Record<string, unknown>)['updatedBy']).toBeDefined();
    });
    it('generates different secret on each rotation', async () => {
      const r1 = await service.rotateSecret('cf_state_abc');
      const r2 = await service.rotateSecret('cf_state_abc');
      expect(r1.clientSecret).not.toBe(r2.clientSecret);
    });
    it('calls logSecretRotated without any secrets', async () => {
      await service.rotateSecret('cf_state_abc', { reason: 'scheduled' });
      expect(mockAuditLogService.logSecretRotated).toHaveBeenCalledTimes(1);
      const arg = (mockAuditLogService.logSecretRotated.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg).not.toHaveProperty('clientSecret');
      expect(arg).not.toHaveProperty('secretHash');
      expect(arg['reason']).toBe('scheduled');
    });
  });

  describe('updateStatus', () => {
    const snap = { _id: new Types.ObjectId(), status: 'ACTIVE' as const };
    const updated = {
      _id: new Types.ObjectId(),
      clientId: 'cf_state_abc',
      actorType: 'STATE' as const,
      stateId: new Types.ObjectId(VALID_STATE_ID),
      scopes: [],
      allowedIps: [],
      status: 'INACTIVE' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      mockAuditLogService.logStatusUpdated.mockResolvedValue(undefined);
      model.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(snap) }) });
      model.findOneAndUpdate.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(updated) }),
      });
    });

    it('updates status to INACTIVE', async () => {
      expect((await service.updateStatus('cf_state_abc', 'INACTIVE')).status).toBe('INACTIVE');
    });
    it('sets revokedAt when status is REVOKED', async () => {
      await service.updateStatus('cf_state_abc', 'REVOKED', undefined, undefined, 'abuse');
      const $set = (model.findOneAndUpdate.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect(($set['$set'] as Record<string, unknown>)['revokedAt']).toBeDefined();
    });
    it('sets revokedReason for REVOKED status', async () => {
      await service.updateStatus('cf_state_abc', 'REVOKED', undefined, undefined, 'policy');
      const $set = (model.findOneAndUpdate.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect(($set['$set'] as Record<string, unknown>)['revokedReason']).toBe('policy');
    });
    it('sets updatedBy and revokedBy when adminId provided', async () => {
      await service.updateStatus('cf_state_abc', 'REVOKED', 'aaaaaaaaaaaaaaaaaaaaaaaa');
      const $set = ((model.findOneAndUpdate.mock.calls[0] as unknown[])[1] as Record<string, unknown>)[
        '$set'
      ] as Record<string, unknown>;
      expect($set['updatedBy']).toBeDefined();
      expect($set['revokedBy']).toBeDefined();
    });
    it('does not include secretHash in response', async () => {
      expect(await service.updateStatus('cf_state_abc', 'INACTIVE')).not.toHaveProperty('secretHash');
    });
    it('throws NotFoundException when client not found', async () => {
      model.findOne.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
      await expect(service.updateStatus('unknown', 'ACTIVE')).rejects.toThrow(NotFoundException);
    });
    it('calls logStatusUpdated with oldStatus and newStatus', async () => {
      await service.updateStatus('cf_state_abc', 'INACTIVE');
      expect(mockAuditLogService.logStatusUpdated).toHaveBeenCalledTimes(1);
      const arg = (mockAuditLogService.logStatusUpdated.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['oldStatus']).toBe('ACTIVE');
      expect(arg['newStatus']).toBe('INACTIVE');
      expect(arg).not.toHaveProperty('secretHash');
    });
  });
});
