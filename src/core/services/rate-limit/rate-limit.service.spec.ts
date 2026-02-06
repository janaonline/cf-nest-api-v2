import { Test, TestingModule } from '@nestjs/testing';
import { RateLimitService } from './rate-limit.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';

describe('RateLimitService', () => {
  let service: RateLimitService;
  let redisService: RedisService;
  let configService: ConfigService;

  const mockRedisService = {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(true),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('redis://localhost:6379'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<RateLimitService>(RateLimitService);
    redisService = module.get<RedisService>(RedisService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkLimit()', () => {
    it('should allow request when under rate limit', async () => {
      mockRedisService.incr.mockResolvedValue(1);

      await service.checkLimit('test-key');

      expect(mockRedisService.incr).toHaveBeenCalledWith('test-key');
      expect(mockRedisService.expire).toHaveBeenCalledWith('test-key', 300);
    });

    it('should throw error when rate limit exceeded', async () => {
      mockRedisService.incr.mockResolvedValue(10);

      await expect(service.checkLimit('test-key')).rejects.toThrow(BadRequestException);
    });

    it('should increment counter on each call', async () => {
      mockRedisService.incr.mockResolvedValue(2);

      await service.checkLimit('test-key');

      expect(mockRedisService.incr).toHaveBeenCalledWith('test-key');
    });
  });
});
