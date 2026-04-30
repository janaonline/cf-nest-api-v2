import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UsersRepository } from 'src/users/users.repository';
import { RedisService } from 'src/core/services/redis/redis.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersRepository: jest.Mocked<UsersRepository>;
  let redisService: jest.Mocked<RedisService>;

  const activeUser = {
    _id: 'user1',
    role: 'ADMIN',
    ulb: 'ulb1',
    state: 'state1',
    isActive: true,
  };

  beforeEach(async () => {
    const mockUsersRepository = { findById: jest.fn() };
    const mockRedisService = { get: jest.fn() };
    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return 'test-jwt-secret';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    usersRepository = module.get(UsersRepository);
    redisService = module.get(RedisService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    const payload = { sub: 'user1', jti: 'jti-abc', exp: 9999999999 };

    it('should return user data for valid payload', async () => {
      redisService.get.mockResolvedValue(null);
      usersRepository.findById.mockResolvedValue(activeUser as any);

      const result = await strategy.validate(payload);
      expect(result).toMatchObject({
        _id: 'user1',
        role: 'ADMIN',
        isActive: true,
        jti: 'jti-abc',
      });
    });

    it('should throw UnauthorizedException for blacklisted token', async () => {
      redisService.get.mockResolvedValue('1');
      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      redisService.get.mockResolvedValue(null);
      usersRepository.findById.mockResolvedValue(null);
      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user is inactive', async () => {
      redisService.get.mockResolvedValue(null);
      usersRepository.findById.mockResolvedValue({ ...activeUser, isActive: false } as any);
      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should not check redis blacklist when jti is missing', async () => {
      const payloadNoJti = { sub: 'user1', exp: 9999999999 } as any;
      usersRepository.findById.mockResolvedValue(activeUser as any);
      await strategy.validate(payloadNoJti);
      expect(redisService.get).not.toHaveBeenCalled();
    });
  });
});
