import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConflictException, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import { UsersRepository } from 'src/users/users.repository';
import { AuthService } from './auth.service';

const mockUser = {
  _id: { toString: () => 'user-id-123' },
  email: 'test@example.com',
  role: 'USER',
  password: 'hashed-password',
  refreshTokenHash: 'hashed-refresh-token',
  otpHash: 'hashed-otp',
  otpExpiresAt: new Date(Date.now() + 300000),
  otpAttempts: 0,
  isActive: true,
  ulb: null,
  state: null,
  toObject: function () { return { ...this }; },
};

const mockUsersRepository = {
  findByEmailWithSensitiveFields: jest.fn(),
  findById: jest.fn(),
  findByIdWithRefreshToken: jest.fn(),
  findByEmail: jest.fn(),
  create: jest.fn(),
  updateRefreshToken: jest.fn(),
  updateLastLogin: jest.fn(),
  updateOtp: jest.fn(),
  incrementOtpAttempts: jest.fn(),
  clearOtp: jest.fn(),
  exists: jest.fn(),
};

const mockJwtService = {
  signAsync: jest.fn().mockResolvedValue('mock-token'),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      JWT_SECRET: 'secret',
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_REFRESH_EXPIRES_IN: '7d',
      REFRESH_COOKIE_NAME: 'refresh_token',
      REFRESH_COOKIE_MAX_AGE_MS: '604800000',
      NODE_ENV: 'test',
      OTP_TTL_SECONDS: '300',
    };
    return map[key];
  }),
};

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockRes = { cookie: jest.fn() } as unknown as Response;

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockJwtService.signAsync.mockResolvedValue('mock-token');
    mockUsersRepository.updateRefreshToken.mockResolvedValue(undefined);
    mockUsersRepository.updateLastLogin.mockResolvedValue(undefined);
    mockUsersRepository.clearOtp.mockResolvedValue(undefined);
    mockUsersRepository.incrementOtpAttempts.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login()', () => {
    it('returns token and user on valid credentials', async () => {
      mockUsersRepository.findByEmailWithSensitiveFields.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);

      const result = await service.login({ email: 'test@example.com', password: 'pass' }, mockRes);
      expect(result.token).toBe('mock-token');
      expect(result.user['password']).toBeUndefined();
    });

    it('throws 401 when user not found (same message as wrong password)', async () => {
      mockUsersRepository.findByEmailWithSensitiveFields.mockResolvedValue(null);
      await expect(
        service.login({ email: 'no@example.com', password: 'pass' }, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when password mismatch (same message)', async () => {
      mockUsersRepository.findByEmailWithSensitiveFields.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);
      await expect(
        service.login({ email: 'test@example.com', password: 'wrong' }, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 403 when user.isActive = false', async () => {
      mockUsersRepository.findByEmailWithSensitiveFields.mockResolvedValue({ ...mockUser, isActive: false });
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);
      await expect(
        service.login({ email: 'test@example.com', password: 'pass' }, mockRes),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('logout()', () => {
    it('clears refreshTokenHash in DB', async () => {
      await service.logout('user-id-123', mockRes);
      expect(mockUsersRepository.updateRefreshToken).toHaveBeenCalledWith('user-id-123', null);
    });

    it('clears refresh cookie', async () => {
      await service.logout('user-id-123', mockRes);
      expect(mockRes.cookie).toHaveBeenCalled();
    });
  });

  describe('refreshTokens()', () => {
    it('rotates tokens on valid refresh token', async () => {
      mockUsersRepository.findByIdWithRefreshToken.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);
      const result = await service.refreshTokens('user-id-123', 'valid-token', mockRes);
      expect(result.token).toBe('mock-token');
    });

    it('throws 440 when hash does not match (theft detection)', async () => {
      mockUsersRepository.findByIdWithRefreshToken.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);
      await expect(
        service.refreshTokens('user-id-123', 'stolen-token', mockRes),
      ).rejects.toThrow(new HttpException('Session expired', 440));
      expect(mockUsersRepository.updateRefreshToken).toHaveBeenCalledWith('user-id-123', null);
    });

    it('throws 440 when no refreshTokenHash in DB', async () => {
      mockUsersRepository.findByIdWithRefreshToken.mockResolvedValue({ ...mockUser, refreshTokenHash: null });
      await expect(
        service.refreshTokens('user-id-123', 'some-token', mockRes),
      ).rejects.toThrow(new HttpException('Session expired', 440));
    });
  });

  describe('register()', () => {
    it('creates user and returns sanitized user', async () => {
      mockUsersRepository.exists.mockResolvedValue(false);
      mockUsersRepository.create.mockResolvedValue({ ...mockUser });
      const result = await service.register({
        name: 'Test',
        email: 'new@example.com',
        password: 'Password@1',
        confirmPassword: 'Password@1',
      });
      expect(result['password']).toBeUndefined();
      expect(result['refreshTokenHash']).toBeUndefined();
    });

    it('throws 409 when email already exists', async () => {
      mockUsersRepository.exists.mockResolvedValue(true);
      await expect(
        service.register({ name: 'Test', email: 'exists@example.com', password: 'Password@1', confirmPassword: 'Password@1' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('sendOtp()', () => {
    it('generates OTP and updates DB', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(mockUser);
      mockCacheManager.get.mockResolvedValue(null);
      mockCacheManager.set.mockResolvedValue(undefined);
      mockUsersRepository.updateOtp.mockResolvedValue(undefined);
      const result = await service.sendOtp('test@example.com');
      expect(result.success).toBe(true);
      expect(mockUsersRepository.updateOtp).toHaveBeenCalled();
    });

    it('throws 429 when rate limit key exists in cache', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(mockUser);
      mockCacheManager.get.mockResolvedValue(true);
      await expect(service.sendOtp('test@example.com')).rejects.toThrow(
        new HttpException('Please wait before requesting another OTP', 429),
      );
    });

    it('returns success even when email not found', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      const result = await service.sendOtp('unknown@example.com');
      expect(result.success).toBe(true);
      expect(mockUsersRepository.updateOtp).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp()', () => {
    it('returns token on correct OTP', async () => {
      mockUsersRepository.findByEmailWithSensitiveFields.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);
      const result = await service.verifyOtp({ email: 'test@example.com', otp: '123456' }, mockRes);
      expect(result.token).toBe('mock-token');
    });

    it('throws 422 on wrong OTP and increments attempts', async () => {
      mockUsersRepository.findByEmailWithSensitiveFields.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);
      await expect(
        service.verifyOtp({ email: 'test@example.com', otp: '000000' }, mockRes),
      ).rejects.toThrow(new HttpException('Invalid OTP', 422));
      expect(mockUsersRepository.incrementOtpAttempts).toHaveBeenCalled();
    });

    it('throws 429 when attempts >= 3', async () => {
      mockUsersRepository.findByEmailWithSensitiveFields.mockResolvedValue({ ...mockUser, otpAttempts: 3 });
      await expect(
        service.verifyOtp({ email: 'test@example.com', otp: '123456' }, mockRes),
      ).rejects.toThrow(new HttpException('Too many attempts, request a new OTP', 429));
    });

    it('throws 422 when OTP expired', async () => {
      mockUsersRepository.findByEmailWithSensitiveFields.mockResolvedValue({
        ...mockUser,
        otpExpiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        service.verifyOtp({ email: 'test@example.com', otp: '123456' }, mockRes),
      ).rejects.toThrow(new HttpException('OTP has expired', 422));
    });
  });
});
