jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('mock-hash'),
}));

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import { SESMailService } from 'src/core/aws-ses/ses.service';
import { UsersRepository } from 'src/users/users.repository';
import { OtpService } from './otp.service';

const mockUser = {
  _id: { toString: () => 'user-id-123' },
  email: 'test@example.com',
  role: 'USER',
  mobile: '9876543210',
  accountantConatactNumber: '9876543210',
  otpHash: 'hashed-otp',
  otpExpiresAt: new Date(Date.now() + 300000),
  otpAttempts: 0,
  isActive: true,
  toObject: function () { return { ...this }; },
};

const mockUsersRepository = {
  findByIdentifier: jest.fn(),
  findByIdentifierWithOtpFields: jest.fn(),
  updateOtp: jest.fn(),
  incrementOtpAttempts: jest.fn(),
  clearOtp: jest.fn(),
  updateRefreshToken: jest.fn(),
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

const mockSesMailService = {
  sendEmail: jest.fn().mockResolvedValue(undefined),
};

const mockRes = { cookie: jest.fn() } as unknown as Response;

describe('OtpService', () => {
  let service: OtpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SESMailService, useValue: mockSesMailService },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
    jest.clearAllMocks();
    mockJwtService.signAsync.mockResolvedValue('mock-token');
    mockUsersRepository.updateRefreshToken.mockResolvedValue(undefined);
    mockUsersRepository.clearOtp.mockResolvedValue(undefined);
    mockUsersRepository.incrementOtpAttempts.mockResolvedValue(undefined);
    mockUsersRepository.updateOtp.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendOtp()', () => {
    it('generates OTP and updates DB', async () => {
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);
      mockCacheManager.get.mockResolvedValue(null);
      mockCacheManager.set.mockResolvedValue(undefined);
      const result = await service.sendOtp({ identifier: 'test@example.com' });
      expect(result.success).toBe(true);
      expect(mockUsersRepository.updateOtp).toHaveBeenCalled();
    });

    it('throws 429 when rate limit key exists in cache', async () => {
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);
      mockCacheManager.get.mockResolvedValue(true);
      await expect(service.sendOtp({ identifier: 'test@example.com' })).rejects.toThrow(
        new HttpException('Please wait before requesting another OTP', 429),
      );
    });

    it('returns success even when user not found', async () => {
      mockUsersRepository.findByIdentifier.mockResolvedValue(null);
      const result = await service.sendOtp({ identifier: 'unknown@example.com' });
      expect(result.success).toBe(true);
      expect(mockUsersRepository.updateOtp).not.toHaveBeenCalled();
    });

    it('works with census code identifier', async () => {
      mockUsersRepository.findByIdentifier.mockResolvedValue({ ...mockUser, role: 'ULB' });
      mockCacheManager.get.mockResolvedValue(null);
      mockCacheManager.set.mockResolvedValue(undefined);
      const result = await service.sendOtp({ identifier: 'ABC123' });
      expect(result.success).toBe(true);
      expect(mockUsersRepository.updateOtp).toHaveBeenCalled();
    });

    it('returns masked mobile and email in response', async () => {
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);
      mockCacheManager.get.mockResolvedValue(null);
      mockCacheManager.set.mockResolvedValue(undefined);
      const result = await service.sendOtp({ identifier: 'test@example.com' });
      expect(result.mobile).toBeDefined();
      expect(result.email).toBeDefined();
      expect(result.requestId).toBe('user-id-123');
    });
  });

  describe('verifyOtp()', () => {
    it('returns token on correct OTP', async () => {
      mockUsersRepository.findByIdentifierWithOtpFields.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const result = await service.verifyOtp({ identifier: 'test@example.com', otp: '123456' }, mockRes);
      expect(result.token).toBe('mock-token');
    });

    it('sanitizes sensitive fields from returned user', async () => {
      mockUsersRepository.findByIdentifierWithOtpFields.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const result = await service.verifyOtp({ identifier: 'test@example.com', otp: '123456' }, mockRes);
      expect(result.user['password']).toBeUndefined();
      expect(result.user['otpHash']).toBeUndefined();
      expect(result.user['refreshTokenHash']).toBeUndefined();
    });

    it('throws 422 on wrong OTP and increments attempts', async () => {
      mockUsersRepository.findByIdentifierWithOtpFields.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.verifyOtp({ identifier: 'test@example.com', otp: '000000' }, mockRes),
      ).rejects.toThrow(new HttpException('Invalid OTP', 422));
      expect(mockUsersRepository.incrementOtpAttempts).toHaveBeenCalled();
    });

    it('throws 429 when attempts >= 3', async () => {
      mockUsersRepository.findByIdentifierWithOtpFields.mockResolvedValue({ ...mockUser, otpAttempts: 3 });
      await expect(
        service.verifyOtp({ identifier: 'test@example.com', otp: '123456' }, mockRes),
      ).rejects.toThrow(new HttpException('Too many attempts, request a new OTP', 429));
    });

    it('throws 422 when OTP expired', async () => {
      mockUsersRepository.findByIdentifierWithOtpFields.mockResolvedValue({
        ...mockUser,
        otpExpiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        service.verifyOtp({ identifier: 'test@example.com', otp: '123456' }, mockRes),
      ).rejects.toThrow(new HttpException('OTP has expired', 422));
      expect(mockUsersRepository.clearOtp).toHaveBeenCalledWith('user-id-123');
    });

    it('throws 422 when no OTP hash found', async () => {
      mockUsersRepository.findByIdentifierWithOtpFields.mockResolvedValue({ ...mockUser, otpHash: null });
      await expect(
        service.verifyOtp({ identifier: 'test@example.com', otp: '123456' }, mockRes),
      ).rejects.toThrow(new HttpException('OTP expired or not requested', 422));
    });

    it('works with census code identifier', async () => {
      mockUsersRepository.findByIdentifierWithOtpFields.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const result = await service.verifyOtp({ identifier: 'ABC123', otp: '123456' }, mockRes);
      expect(result.token).toBe('mock-token');
    });
  });
});
