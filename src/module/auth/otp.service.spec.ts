jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('hashed-otp'),
}));

import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import type { Response } from 'express';
import { SESMailService } from 'src/core/aws-ses/ses.service';
import { RedisService } from 'src/core/services/redis/redis.service';
import { UsersRepository } from 'src/users/users.repository';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockUser = {
  _id: { toString: () => 'user-id-123' },
  email: 'test@example.com',
  role: 'USER',
  mobile: '9876543210',
  accountantConatactNumber: '9876543210',
  isActive: true,
  toObject: function () {
    return { ...this };
  },
};

const FUTURE_ISO = new Date(Date.now() + 300_000).toISOString();
const PAST_ISO = new Date(Date.now() - 1_000).toISOString();

function makeState(overrides: Partial<{
  hashedOtp: string; expiresAt: string; verifyAttempts: number; resendCount: number;
}> = {}) {
  return JSON.stringify({
    hashedOtp: 'hashed-otp',
    purpose: 'login',
    identifier: 'test@example.com',
    createdAt: new Date().toISOString(),
    expiresAt: FUTURE_ISO,
    resendCount: 1,
    verifyAttempts: 0,
    ...overrides,
  });
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUsersRepository = {
  findByIdentifier: jest.fn(),
  updateRefreshToken: jest.fn(),
  updatePassword: jest.fn(),
};

const mockAuthService = {
  generateTokens: jest.fn().mockResolvedValue({ accessToken: 'mock-token', refreshToken: 'mock-refresh' }),
  saveRefreshToken: jest.fn().mockResolvedValue(undefined),
  setRefreshCookie: jest.fn(),
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
      OTP_LENGTH: '6',
      OTP_TTL_SECONDS: '300',
      OTP_RESEND_COOLDOWN_SECONDS: '30',
      OTP_MAX_VERIFY_ATTEMPTS: '5',
      OTP_MAX_RESEND_ATTEMPTS: '3',
      OTP_LOCK_SECONDS: '900',
    };
    return map[key];
  }),
};

const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockSesMailService = {
  sendEmail: jest.fn().mockResolvedValue(undefined),
};

const mockRes = { cookie: jest.fn() } as unknown as Response;

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('OtpService', () => {
  let service: OtpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SESMailService, useValue: mockSesMailService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
    jest.clearAllMocks();

    // Default: no lock, no cooldown, no existing state
    mockRedisService.get.mockResolvedValue(null);
    mockRedisService.set.mockResolvedValue(undefined);
    mockRedisService.del.mockResolvedValue(undefined);

    mockAuthService.generateTokens.mockResolvedValue({ accessToken: 'mock-token', refreshToken: 'mock-refresh' });
    mockAuthService.saveRefreshToken.mockResolvedValue(undefined);
    mockAuthService.setRefreshCookie.mockImplementation(() => undefined);
    mockUsersRepository.updateRefreshToken.mockResolvedValue(undefined);
    mockUsersRepository.updatePassword.mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── sendOtp ──────────────────────────────────────────────────────────────

  describe('sendOtp()', () => {
    it('stores hashed OTP in Redis and returns success', async () => {
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);

      const result = await service.sendOtp({ identifier: 'test@example.com' });

      expect(result.success).toBe(true);
      expect(result.message).toBe('OTP sent successfully');
      expect(mockRedisService.set).toHaveBeenCalledTimes(2); // state + cooldown
      expect(bcrypt.hash).toHaveBeenCalled();
    });

    it('returns success without touching Redis when user not found (anti-enumeration)', async () => {
      mockUsersRepository.findByIdentifier.mockResolvedValue(null);

      const result = await service.sendOtp({ identifier: 'unknown@example.com' });

      expect(result.success).toBe(true);
      expect(mockRedisService.set).not.toHaveBeenCalled();
    });

    it('throws 429 when cooldown key exists in Redis', async () => {
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);
      mockRedisService.get.mockImplementation((key: string) =>
        key.startsWith('otp:cooldown') ? Promise.resolve('1') : Promise.resolve(null),
      );

      await expect(service.sendOtp({ identifier: 'test@example.com' })).rejects.toThrow(
        new HttpException('Please wait before requesting another OTP.', 429),
      );
      expect(mockRedisService.set).not.toHaveBeenCalled();
    });

    it('throws 429 when lock key exists in Redis', async () => {
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);
      mockRedisService.get.mockImplementation((key: string) =>
        key.startsWith('otp:lock') ? Promise.resolve('1') : Promise.resolve(null),
      );

      await expect(service.sendOtp({ identifier: 'test@example.com' })).rejects.toThrow(
        new HttpException('Too many attempts. Please try again later.', 429),
      );
    });

    it('throws 429 when resendCount has reached the max resend limit', async () => {
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);
      // State already has resendCount = 3 (== OTP_MAX_RESEND_ATTEMPTS)
      mockRedisService.get.mockImplementation((key: string) =>
        key.startsWith('otp:state')
          ? Promise.resolve(makeState({ resendCount: 3 }))
          : Promise.resolve(null),
      );

      await expect(service.sendOtp({ identifier: 'test@example.com' })).rejects.toThrow(
        new HttpException('Maximum OTP requests reached. Please try again later.', 429),
      );
    });

    it('increments resendCount on a subsequent resend', async () => {
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);
      mockRedisService.get.mockImplementation((key: string) =>
        key.startsWith('otp:state')
          ? Promise.resolve(makeState({ resendCount: 1 }))
          : Promise.resolve(null),
      );

      const result = await service.sendOtp({ identifier: 'test@example.com' });

      expect(result.success).toBe(true);
      const stateArg = mockRedisService.set.mock.calls[0][1];
      const parsed = typeof stateArg === 'string' ? JSON.parse(stateArg) : stateArg;
      expect(parsed.resendCount).toBe(2);
    });

    it('returns masked mobile and email', async () => {
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);

      const result = await service.sendOtp({ identifier: 'test@example.com' });

      expect(result.mobile).toMatch(/\*/);
      expect(result.email).toMatch(/\*/);
    });

  });

  // ─── verifyOtp ────────────────────────────────────────────────────────────

  describe('verifyOtp()', () => {
    /** Returns state JSON only for otp:state keys; null for lock/cooldown keys. */
    function stateOnlyGet(stateJson: string) {
      return (key: string) =>
        key.startsWith('otp:state') ? Promise.resolve(stateJson) : Promise.resolve(null);
    }

    it('returns access token and sanitized user on correct OTP', async () => {
      mockRedisService.get.mockImplementation(stateOnlyGet(makeState()));
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.verifyOtp(
        { identifier: 'test@example.com', otp: '111111' },
        mockRes,
      );

      expect(result.token).toBe('mock-token');
      expect(result.user['password']).toBeUndefined();
      expect(result.user['otpHash']).toBeUndefined();
    });

    it('deletes OTP state from Redis after successful verification (no replay)', async () => {
      mockRedisService.get.mockImplementation(stateOnlyGet(makeState()));
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.verifyOtp({ identifier: 'test@example.com', otp: '111111' }, mockRes);

      expect(mockRedisService.del).toHaveBeenCalledWith(
        expect.stringContaining('otp:state:login:test@example.com'),
      );
    });

    it('throws 422 and increments verifyAttempts on wrong OTP', async () => {
      mockRedisService.get.mockImplementation(stateOnlyGet(makeState({ verifyAttempts: 0 })));
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.verifyOtp({ identifier: 'test@example.com', otp: '000000' }, mockRes),
      ).rejects.toThrow(new HttpException('Invalid or expired OTP', 422));

      // State was re-saved with incremented attempt count
      const stateArg = mockRedisService.set.mock.calls[0][1];
      const parsed = typeof stateArg === 'string' ? JSON.parse(stateArg) : stateArg;
      expect(parsed.verifyAttempts).toBe(1);
    });

    it('triggers lock and throws 429 after exhausting all verify attempts', async () => {
      // 4 previous failures — next wrong attempt should lock
      mockRedisService.get.mockImplementation(stateOnlyGet(makeState({ verifyAttempts: 4 })));
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.verifyOtp({ identifier: 'test@example.com', otp: '000000' }, mockRes),
      ).rejects.toThrow(new HttpException('Too many attempts. Please request a new OTP.', 429));

      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining('otp:lock:login:test@example.com'),
        '1',
        900,
      );
    });

    it('throws 429 immediately when lock key already exists', async () => {
      mockRedisService.get.mockImplementation((key: string) =>
        key.startsWith('otp:lock') ? Promise.resolve('1') : Promise.resolve(null),
      );

      await expect(
        service.verifyOtp({ identifier: 'test@example.com', otp: '111111' }, mockRes),
      ).rejects.toThrow(new HttpException('Too many attempts. Please try again later.', 429));
    });

    it('throws 422 when no OTP state exists in Redis', async () => {
      // All keys return null
      mockRedisService.get.mockResolvedValue(null);

      await expect(
        service.verifyOtp({ identifier: 'test@example.com', otp: '111111' }, mockRes),
      ).rejects.toThrow(new HttpException('Invalid or expired OTP', 422));
    });

    it('throws 422 and cleans up Redis when OTP TTL has naturally expired', async () => {
      mockRedisService.get.mockImplementation(stateOnlyGet(makeState({ expiresAt: PAST_ISO })));

      await expect(
        service.verifyOtp({ identifier: 'test@example.com', otp: '111111' }, mockRes),
      ).rejects.toThrow(new HttpException('Invalid or expired OTP', 422));

      expect(mockRedisService.del).toHaveBeenCalledWith(
        expect.stringContaining('otp:state:login:test@example.com'),
      );
    });

    it('throws 429 when verifyAttempts already == maxVerifyAttempts before comparison', async () => {
      // verifyAttempts has already reached the cap (can happen if state was persisted at limit)
      mockRedisService.get.mockImplementation(stateOnlyGet(makeState({ verifyAttempts: 5 })));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true); // even a correct OTP is blocked

      await expect(
        service.verifyOtp({ identifier: 'test@example.com', otp: '111111' }, mockRes),
      ).rejects.toThrow(new HttpException('Too many attempts. Please request a new OTP.', 429));
    });

    it('throws UnauthorizedException when user disappears after OTP verification', async () => {
      mockRedisService.get.mockImplementation(stateOnlyGet(makeState()));
      mockUsersRepository.findByIdentifier.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.verifyOtp({ identifier: 'test@example.com', otp: '111111' }, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── forgotPasswordReset ─────────────────────────────────────────────────────

  describe('forgotPasswordReset()', () => {
    const fpDto = {
      identifier: 'test@example.com',
      otp: '111111',
      newPassword: 'NewPass@1',
      confirmPassword: 'NewPass@1',
    };

    function makeFpState(overrides: Partial<{
      hashedOtp: string; expiresAt: string; verifyAttempts: number;
    }> = {}) {
      return JSON.stringify({
        hashedOtp: 'hashed-otp',
        purpose: 'forgot-password',
        identifier: 'test@example.com',
        createdAt: new Date().toISOString(),
        expiresAt: FUTURE_ISO,
        resendCount: 1,
        verifyAttempts: 0,
        ...overrides,
      });
    }

    function fpStateOnlyGet(stateJson: string) {
      return (key: string) =>
        key.startsWith('otp:state') ? Promise.resolve(stateJson) : Promise.resolve(null);
    }

    it('updates password and returns success message on valid OTP', async () => {
      mockRedisService.get.mockImplementation(fpStateOnlyGet(makeFpState()));
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-new-password');

      const result = await service.forgotPasswordReset(fpDto);

      expect(result).toEqual({ message: 'Password updated successfully' });
      expect(mockUsersRepository.updatePassword).toHaveBeenCalledWith(
        'user-id-123',
        'hashed-new-password',
      );
    });

    it('hashes the new password before saving', async () => {
      mockRedisService.get.mockImplementation(fpStateOnlyGet(makeFpState()));
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.forgotPasswordReset(fpDto);

      expect(bcrypt.hash).toHaveBeenCalledWith(fpDto.newPassword, 10);
    });

    it('deletes OTP state from Redis after successful reset (no replay)', async () => {
      mockRedisService.get.mockImplementation(fpStateOnlyGet(makeFpState()));
      mockUsersRepository.findByIdentifier.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.forgotPasswordReset(fpDto);

      expect(mockRedisService.del).toHaveBeenCalledWith(
        expect.stringContaining('otp:state:forgot-password:test@example.com'),
      );
    });

    it('throws 422 when no OTP state exists in Redis', async () => {
      mockRedisService.get.mockResolvedValue(null);

      await expect(service.forgotPasswordReset(fpDto)).rejects.toThrow(
        new HttpException('Invalid or expired OTP', 422),
      );
    });

    it('throws 422 and cleans up Redis when OTP TTL has naturally expired', async () => {
      mockRedisService.get.mockImplementation(fpStateOnlyGet(makeFpState({ expiresAt: PAST_ISO })));

      await expect(service.forgotPasswordReset(fpDto)).rejects.toThrow(
        new HttpException('Invalid or expired OTP', 422),
      );
      expect(mockRedisService.del).toHaveBeenCalledWith(
        expect.stringContaining('otp:state:forgot-password:test@example.com'),
      );
    });

    it('throws 429 immediately when lock key already exists', async () => {
      mockRedisService.get.mockImplementation((key: string) =>
        key.startsWith('otp:lock') ? Promise.resolve('1') : Promise.resolve(null),
      );

      await expect(service.forgotPasswordReset(fpDto)).rejects.toThrow(
        new HttpException('Too many attempts. Please try again later.', 429),
      );
    });

    it('throws 422 and increments verifyAttempts on wrong OTP', async () => {
      mockRedisService.get.mockImplementation(fpStateOnlyGet(makeFpState({ verifyAttempts: 0 })));
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.forgotPasswordReset(fpDto)).rejects.toThrow(
        new HttpException('Invalid or expired OTP', 422),
      );

      const stateArg = mockRedisService.set.mock.calls[0][1];
      const parsed = typeof stateArg === 'string' ? JSON.parse(stateArg) : stateArg;
      expect(parsed.verifyAttempts).toBe(1);
    });

    it('triggers lock and throws 429 after exhausting all verify attempts', async () => {
      mockRedisService.get.mockImplementation(fpStateOnlyGet(makeFpState({ verifyAttempts: 4 })));
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.forgotPasswordReset(fpDto)).rejects.toThrow(
        new HttpException('Too many attempts. Please request a new OTP.', 429),
      );

      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining('otp:lock:forgot-password:test@example.com'),
        '1',
        900,
      );
    });

    it('throws 429 when verifyAttempts already == maxVerifyAttempts before comparison', async () => {
      mockRedisService.get.mockImplementation(fpStateOnlyGet(makeFpState({ verifyAttempts: 5 })));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.forgotPasswordReset(fpDto)).rejects.toThrow(
        new HttpException('Too many attempts. Please request a new OTP.', 429),
      );
    });

    it('throws UnauthorizedException when user disappears after valid OTP', async () => {
      mockRedisService.get.mockImplementation(fpStateOnlyGet(makeFpState()));
      mockUsersRepository.findByIdentifier.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.forgotPasswordReset(fpDto)).rejects.toThrow(UnauthorizedException);
    });
  });
});
