import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ApiClientAuditLog } from '../entities/api-client-audit-log.schema';
import { ApiClientAuditLogService } from './api-client-audit-log.service';

const mockModel = { create: jest.fn() };

describe('ApiClientAuditLogService', () => {
  let service: ApiClientAuditLogService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiClientAuditLogService, { provide: getModelToken(ApiClientAuditLog.name), useValue: mockModel }],
    }).compile();
    service = module.get<ApiClientAuditLogService>(ApiClientAuditLogService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('logSecretRotated', () => {
    const rotatedData = {
      apiClientId: new Types.ObjectId(),
      clientId: 'cf_state_abc',
      performedBy: new Types.ObjectId(),
      reason: 'scheduled',
    };

    it('is fire-and-forget — does not return a Promise the caller must await', () => {
      mockModel.create.mockResolvedValue({});
      const result = service.logSecretRotated(rotatedData);
      expect(result).toBeUndefined();
    });

    it('does not throw or reject when the audit insert fails', async () => {
      mockModel.create.mockRejectedValue(new Error('audit store unavailable'));
      expect(() => service.logSecretRotated(rotatedData)).not.toThrow();
      // Allow the internally-chained rejection to settle before the suite exits.
      await Promise.resolve().then(() => Promise.resolve());
    });

    it('still attempts the insert with the expected action', () => {
      mockModel.create.mockResolvedValue({});
      service.logSecretRotated(rotatedData);
      expect(mockModel.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'API_CLIENT_SECRET_ROTATED' }));
    });
  });
});
