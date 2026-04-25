jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('mock-hash'),
}));

import { ConflictException, HttpException } from '@nestjs/common';
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
  isActive: true,
  ulb: null,
  state: null,
  toObject: function () { return { ...this }; },
};

const mockUsersRepository = {
  findById: jest.fn(),
  findByIdWithRefreshToken: jest.fn(),
  create: jest.fn(),
  updateRefreshToken: jest.fn(),
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
    };
    return map[key];
  }),
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
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockJwtService.signAsync.mockResolvedValue('mock-token');
    mockUsersRepository.updateRefreshToken.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const result = await service.refreshTokens('user-id-123', 'valid-token', mockRes);
      expect(result.token).toBe('mock-token');
    });

    it('throws 440 when hash does not match (theft detection)', async () => {
      mockUsersRepository.findByIdWithRefreshToken.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
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
});
