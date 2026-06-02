import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';
import { AuthService } from '../auth.service';

describe('JwtRefreshStrategy', () => {
  let strategy: JwtRefreshStrategy;
  let authService: jest.Mocked<AuthService>;

  const cookieName = 'refresh_token';

  const mockUserDoc = {
    _id: 'user1',
    role: 'ADMIN',
    isActive: true,
    toObject: jest.fn().mockReturnValue({ _id: 'user1', role: 'ADMIN', isActive: true }),
  };

  beforeEach(async () => {
    const mockAuthService = { validateRefreshToken: jest.fn() };
    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
        if (key === 'REFRESH_COOKIE_NAME') return cookieName;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtRefreshStrategy,
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get<JwtRefreshStrategy>(JwtRefreshStrategy);
    authService = module.get(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    const payload = { sub: 'user1', iat: 1000, exp: 9999999999 };
    const makeReq = (token: string | undefined) =>
      ({ cookies: token !== undefined ? { [cookieName]: token } : {} } as any);

    it('should return user merged with refreshToken on success', async () => {
      authService.validateRefreshToken.mockResolvedValue(mockUserDoc as any);
      const req = makeReq('valid-refresh-token');
      const result = await strategy.validate(req, payload);
      expect(result).toMatchObject({ _id: 'user1', role: 'ADMIN', refreshToken: 'valid-refresh-token' });
      expect(authService.validateRefreshToken).toHaveBeenCalledWith('user1', 'valid-refresh-token');
    });

    it('should throw HttpException 440 when cookie is missing', async () => {
      const req = makeReq(undefined);
      await expect(strategy.validate(req, payload)).rejects.toThrow(HttpException);
      try {
        await strategy.validate(req, payload);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(440);
      }
    });

    it('should throw HttpException 440 when validateRefreshToken returns null', async () => {
      authService.validateRefreshToken.mockResolvedValue(null);
      const req = makeReq('some-token');
      await expect(strategy.validate(req, payload)).rejects.toThrow(HttpException);
      try {
        await strategy.validate(req, payload);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(440);
      }
    });
  });
});
