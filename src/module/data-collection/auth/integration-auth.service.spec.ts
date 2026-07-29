import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiClientAuditLogService } from 'src/module/api-clients/services/api-client-audit-log.service';
import { ApiClientService } from 'src/module/api-clients/services/api-client.service';
import { IntegrationAuthService } from './integration-auth.service';

const mockApiClientService = {
  findByClientIdWithSecret: jest.fn(),
  verifySecret: jest.fn(),
  touchLastUsed: jest.fn(),
};
const mockJwtService = { signAsync: jest.fn().mockResolvedValue('signed-token') };
const mockConfig = {
  get: jest.fn((key: string, def?: number) => (key === 'DATA_COLLECTION_JWT_EXPIRES_IN_SECONDS' ? 900 : (def ?? ''))),
};
const mockAuditLogService = {
  logTokenCreated: jest.fn(),
  logTokenFailed: jest.fn(),
};

const activeClient = {
  _id: { toString: () => 'clientObjId' },
  clientId: 'test-client',
  secretHash: 'hashed-secret',
  actorType: 'STATE',
  stateId: { toString: () => 'stateId1' },
  ulbId: undefined,
  scopes: ['data_collection:template:read'],
  allowedIps: [],
  status: 'ACTIVE',
};

describe('IntegrationAuthService', () => {
  let service: IntegrationAuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationAuthService,
        { provide: ApiClientService, useValue: mockApiClientService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfig },
        { provide: ApiClientAuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();
    service = module.get<IntegrationAuthService>(IntegrationAuthService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('createToken', () => {
    it('returns token with tokenType Bearer and expiresIn for valid credentials', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue(activeClient);
      mockApiClientService.verifySecret.mockResolvedValue(true);

      const result = await service.createToken({ clientId: 'test-client', clientSecret: 'secret' }, '127.0.0.1');

      expect(result.tokenType).toBe('Bearer');
      expect(result.accessToken).toBe('signed-token');
      expect(result.expiresIn).toBe(900);
    });

    it('throws UnauthorizedException for wrong secret', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue(activeClient);
      mockApiClientService.verifySecret.mockResolvedValue(false);

      await expect(
        service.createToken({ clientId: 'test-client', clientSecret: 'wrong' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws generic error (not revealing which part failed) for unknown client', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue(null);
      mockApiClientService.verifySecret.mockResolvedValue(false);

      await expect(service.createToken({ clientId: 'unknown', clientSecret: 'any' }, '127.0.0.1')).rejects.toThrow(
        'Invalid client credentials',
      );
    });

    it('throws for inactive client', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue({ ...activeClient, status: 'INACTIVE' });
      mockApiClientService.verifySecret.mockResolvedValue(true);

      await expect(
        service.createToken({ clientId: 'test-client', clientSecret: 'secret' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws for revoked client', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue({ ...activeClient, status: 'REVOKED' });
      mockApiClientService.verifySecret.mockResolvedValue(true);

      await expect(
        service.createToken({ clientId: 'test-client', clientSecret: 'secret' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects request from IP not in allowedIps', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue({ ...activeClient, allowedIps: ['10.0.0.1'] });
      mockApiClientService.verifySecret.mockResolvedValue(true);

      await expect(service.createToken({ clientId: 'test-client', clientSecret: 'secret' }, '8.8.8.8')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('allows request when IP matches allowedIps', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue({ ...activeClient, allowedIps: ['10.0.0.1'] });
      mockApiClientService.verifySecret.mockResolvedValue(true);

      const result = await service.createToken({ clientId: 'test-client', clientSecret: 'secret' }, '10.0.0.1');
      expect(result.tokenType).toBe('Bearer');
    });

    it('calls touchLastUsed after successful auth', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue(activeClient);
      mockApiClientService.verifySecret.mockResolvedValue(true);

      await service.createToken({ clientId: 'test-client', clientSecret: 'secret' }, '127.0.0.1');
      expect(mockApiClientService.touchLastUsed).toHaveBeenCalledWith(activeClient._id);
    });

    it('logs successful token creation with logTokenCreated', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue(activeClient);
      mockApiClientService.verifySecret.mockResolvedValue(true);

      await service.createToken({ clientId: 'test-client', clientSecret: 'secret' }, '10.0.0.1', 'curl/7.x');
      expect(mockAuditLogService.logTokenCreated).toHaveBeenCalledTimes(1);
      const arg = (mockAuditLogService.logTokenCreated.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['clientId']).toBe('test-client');
      expect(arg).not.toHaveProperty('secretHash');
      expect(arg).not.toHaveProperty('accessToken');
    });

    it('logs INVALID_CREDENTIALS failure for wrong secret', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue(activeClient);
      mockApiClientService.verifySecret.mockResolvedValue(false);

      await expect(
        service.createToken({ clientId: 'test-client', clientSecret: 'wrong' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockAuditLogService.logTokenFailed).toHaveBeenCalledTimes(1);
      const arg = (mockAuditLogService.logTokenFailed.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['failureReason']).toBe('INVALID_CREDENTIALS');
    });

    it('logs INACTIVE_CLIENT failure for inactive client', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue({ ...activeClient, status: 'INACTIVE' });
      mockApiClientService.verifySecret.mockResolvedValue(true);

      await expect(
        service.createToken({ clientId: 'test-client', clientSecret: 'secret' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockAuditLogService.logTokenFailed).toHaveBeenCalledTimes(1);
      const arg = (mockAuditLogService.logTokenFailed.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['failureReason']).toBe('INACTIVE_CLIENT');
    });

    it('logs REVOKED_CLIENT failure for revoked client', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue({ ...activeClient, status: 'REVOKED' });
      mockApiClientService.verifySecret.mockResolvedValue(true);

      await expect(
        service.createToken({ clientId: 'test-client', clientSecret: 'secret' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
      const arg = (mockAuditLogService.logTokenFailed.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['failureReason']).toBe('REVOKED_CLIENT');
    });

    it('logs IP_NOT_ALLOWED but returns generic UnauthorizedException', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue({ ...activeClient, allowedIps: ['10.0.0.1'] });
      mockApiClientService.verifySecret.mockResolvedValue(true);

      await expect(service.createToken({ clientId: 'test-client', clientSecret: 'secret' }, '8.8.8.8')).rejects.toThrow(
        'Invalid client credentials',
      );
      const arg = (mockAuditLogService.logTokenFailed.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['failureReason']).toBe('IP_NOT_ALLOWED');
    });

    it('passes userAgent to audit log', async () => {
      mockApiClientService.findByClientIdWithSecret.mockResolvedValue(null);
      mockApiClientService.verifySecret.mockResolvedValue(false);

      await expect(service.createToken({ clientId: 'x', clientSecret: 'y' }, '1.2.3.4', 'MyAgent/1.0')).rejects.toThrow(
        UnauthorizedException,
      );
      const arg = (mockAuditLogService.logTokenFailed.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['userAgent']).toBe('MyAgent/1.0');
    });
  });

  describe('isIpAllowed', () => {
    it('returns true when allowedIps is empty', () => {
      expect(service.isIpAllowed('1.2.3.4', [])).toBe(true);
    });

    it('returns true when IP matches entry in allowedIps', () => {
      expect(service.isIpAllowed('10.0.0.1', ['10.0.0.1', '10.0.0.2'])).toBe(true);
    });

    it('returns false when IP is not in allowedIps', () => {
      expect(service.isIpAllowed('8.8.8.8', ['10.0.0.1'])).toBe(false);
    });

    it('normalizes ::ffff:127.0.0.1 to 127.0.0.1', () => {
      expect(service.isIpAllowed('::ffff:127.0.0.1', ['127.0.0.1'])).toBe(true);
    });

    it('normalizes ::1 is compared as-is (IPv6 loopback)', () => {
      expect(service.isIpAllowed('::1', ['::1'])).toBe(true);
    });

    it('does not match ::1 against 127.0.0.1 (different representations)', () => {
      expect(service.isIpAllowed('::1', ['127.0.0.1'])).toBe(false);
    });
  });
});
