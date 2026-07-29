import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiClientService } from 'src/module/api-clients/services/api-client.service';
import { IntegrationJwtGuard } from './integration-jwt.guard';

const mockJwtService = { verifyAsync: jest.fn() };
const mockApiClientService = { findById: jest.fn() };
const mockConfig = { get: jest.fn().mockReturnValue('test-secret') };

const validPayload = {
  sub: 'clientObjId',
  clientId: 'c1',
  actorType: 'STATE',
  stateId: 'st1',
  scopes: ['data_collection:template:read'],
};

const activeClient = {
  _id: { toString: () => 'clientObjId' },
  clientId: 'c1',
  actorType: 'STATE',
  stateId: { toString: () => 'st1' },
  ulbId: undefined,
  scopes: ['data_collection:template:read'],
  status: 'ACTIVE',
};

function makeContext(headers: Record<string, string> = {}): ExecutionContext {
  const request = { headers, apiClient: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('IntegrationJwtGuard', () => {
  let guard: IntegrationJwtGuard;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationJwtGuard,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ApiClientService, useValue: mockApiClientService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    guard = module.get<IntegrationJwtGuard>(IntegrationJwtGuard);
  });

  it('should be defined', () => expect(guard).toBeDefined());

  it('throws UnauthorizedException when Authorization header is missing', async () => {
    await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
  });

  it('throws for invalid token', async () => {
    mockJwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
    await expect(guard.canActivate(makeContext({ authorization: 'Bearer bad-token' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws for inactive client', async () => {
    mockJwtService.verifyAsync.mockResolvedValue(validPayload);
    mockApiClientService.findById.mockResolvedValue({ ...activeClient, status: 'INACTIVE' });

    await expect(guard.canActivate(makeContext({ authorization: 'Bearer valid-token' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws when client not found', async () => {
    mockJwtService.verifyAsync.mockResolvedValue(validPayload);
    mockApiClientService.findById.mockResolvedValue(null);

    await expect(guard.canActivate(makeContext({ authorization: 'Bearer valid-token' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('attaches apiClient context to request for valid token', async () => {
    mockJwtService.verifyAsync.mockResolvedValue(validPayload);
    mockApiClientService.findById.mockResolvedValue(activeClient);

    const request = { headers: { authorization: 'Bearer valid-token' }, apiClient: undefined };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(request.apiClient).toMatchObject({
      clientId: 'c1',
      actorType: 'STATE',
      stateId: 'st1',
    });
  });

  it('does not expose secretHash in attached context', async () => {
    mockJwtService.verifyAsync.mockResolvedValue(validPayload);
    mockApiClientService.findById.mockResolvedValue({ ...activeClient, secretHash: 'should-not-appear' });

    const request = { headers: { authorization: 'Bearer valid-token' }, apiClient: undefined };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await guard.canActivate(ctx);
    expect((request.apiClient as unknown as Record<string, unknown>)?.secretHash).toBeUndefined();
  });
});
