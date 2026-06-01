jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('mock-hash'),
}));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import { State } from 'src/schemas/state.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';
import { UsersRepository } from 'src/users/users.repository';
import { AuthService } from './auth.service';
import { LoginService } from './login.service';

const mockLoginUser = {
  _id: { toString: () => 'user-id-123' },
  email: 'test@example.com',
  role: 'USER',
  password: 'hashed-password',
  status: undefined,
  isEmailVerified: true,
  isLocked: false,
  lockUntil: null,
  loginAttempts: 0,
  name: 'Test User',
  isActive: true,
  ulb: null,
  state: null,
  designation: 'Test',
  isVerified2223: false,
};

const mockUsersRepository = {
  findByIdentifierWithSensitiveFields: jest.fn(),
  updateRefreshToken: jest.fn(),
  updateLastLogin: jest.fn(),
  resetLoginAttempts: jest.fn(),
  incrementLoginAttempts: jest.fn(),
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
    };
    return map[key];
  }),
};

const mockStateModel = {
  findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
};

const mockUlbModel = {
  findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
};

const mockYearModel = {
  find: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
  }),
};

const mockAuthService = {
  generateTokens: jest.fn().mockResolvedValue({ accessToken: 'mock-token', refreshToken: 'mock-refresh' }),
  saveRefreshToken: jest.fn().mockResolvedValue(undefined),
  setRefreshCookie: jest.fn(),
};

const mockRes = { cookie: jest.fn() } as unknown as Response;

describe('LoginService', () => {
  let service: LoginService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginService,
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: AuthService, useValue: mockAuthService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getModelToken(State.name), useValue: mockStateModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: getModelToken(Year.name), useValue: mockYearModel },
      ],
    }).compile();

    service = module.get<LoginService>(LoginService);
    jest.clearAllMocks();
    mockJwtService.signAsync.mockResolvedValue('mock-token');
    mockUsersRepository.updateRefreshToken.mockResolvedValue(undefined);
    mockAuthService.generateTokens.mockResolvedValue({ accessToken: 'mock-token', refreshToken: 'mock-refresh' });
    mockAuthService.saveRefreshToken.mockResolvedValue(undefined);
    mockAuthService.setRefreshCookie.mockImplementation(() => undefined);
    mockUsersRepository.updateLastLogin.mockResolvedValue(undefined);
    mockUsersRepository.resetLoginAttempts.mockResolvedValue(undefined);
    mockUsersRepository.incrementLoginAttempts.mockResolvedValue(undefined);
    mockStateModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockUlbModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    mockYearModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login()', () => {
    it('returns token and user on valid credentials', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue(mockLoginUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({ identifier: 'test@example.com', password: 'pass' }, mockRes);
      expect(result.token).toBe('mock-token');
    });

    it('throws 401 when user not found (same message as wrong password)', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue(null);
      await expect(
        service.login({ identifier: 'no@example.com', password: 'pass' }, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 401 when password mismatch (same message)', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue(mockLoginUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.login({ identifier: 'test@example.com', password: 'wrong' }, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws 403 when email is not verified', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
        ...mockLoginUser,
        isEmailVerified: false,
      });
      await expect(
        service.login({ identifier: 'test@example.com', password: 'pass' }, mockRes),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws 403 when account is locked', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
        ...mockLoginUser,
        isLocked: true,
        lockUntil: Date.now() + 3600000,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(
        service.login({ identifier: 'test@example.com', password: 'pass' }, mockRes),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws 403 when account status is PENDING', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
        ...mockLoginUser,
        status: 'PENDING',
      });
      await expect(
        service.login({ identifier: 'test@example.com', password: 'pass' }, mockRes),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws 403 when account status is REJECTED', async () => {
      mockUsersRepository.findByIdentifierWithSensitiveFields.mockResolvedValue({
        ...mockLoginUser,
        status: 'REJECTED',
        rejectReason: 'Duplicate account',
      });
      await expect(
        service.login({ identifier: 'test@example.com', password: 'pass' }, mockRes),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
