import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationAuthController } from './integration-auth.controller';
import { IntegrationAuthService } from './integration-auth.service';

const mockTokenResponse = { accessToken: 'jwt.token.here', tokenType: 'Bearer' as const, expiresIn: 900 };

const mockService = {
  createToken: jest.fn().mockResolvedValue(mockTokenResponse),
};

describe('IntegrationAuthController', () => {
  let controller: IntegrationAuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntegrationAuthController],
      providers: [{ provide: IntegrationAuthService, useValue: mockService }],
    }).compile();
    controller = module.get<IntegrationAuthController>(IntegrationAuthController);
  });

  it('should be defined', () => expect(controller).toBeDefined());

  describe('createToken', () => {
    const payload = { clientId: 'cf_state_abc', clientSecret: 'secret123' };

    it('delegates to service.createToken with payload, ip, and userAgent', async () => {
      await controller.createToken(payload as never, '127.0.0.1', 'test-agent');
      expect(mockService.createToken).toHaveBeenCalledWith(payload, '127.0.0.1', 'test-agent');
    });

    it('falls back to empty string when ip is falsy', async () => {
      await controller.createToken(payload as never, '' as never, undefined);
      expect(mockService.createToken).toHaveBeenCalledWith(payload, '', undefined);
    });

    it('returns accessToken, tokenType, and expiresIn', async () => {
      const result = await controller.createToken(payload as never, '127.0.0.1');
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('tokenType', 'Bearer');
      expect(result).toHaveProperty('expiresIn');
    });

    it('does not expose secretHash or clientSecret in response', async () => {
      const result = await controller.createToken(payload as never, '127.0.0.1');
      expect(result).not.toHaveProperty('secretHash');
      expect(result).not.toHaveProperty('clientSecret');
    });
  });
});
