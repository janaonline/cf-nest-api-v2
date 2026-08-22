import { Test, TestingModule } from '@nestjs/testing';
import { XviFcCacheService, XVIFC_CACHE_KEY_PREFIX } from './xvi-fc-cache.service';
import { RedisService } from '../../../core/services/redis/redis.service';

describe('XviFcCacheService', () => {
  let service: XviFcCacheService;
  let mockRedisService: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    delByPattern: jest.Mock;
  };

  beforeEach(async () => {
    mockRedisService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      delByPattern: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [XviFcCacheService, { provide: RedisService, useValue: mockRedisService }],
    }).compile();

    service = module.get(XviFcCacheService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('exports the expected cache key prefix', () => {
    expect(XVIFC_CACHE_KEY_PREFIX).toBe('xvifc:cache');
  });

  describe('get', () => {
    it('returns null on a cache miss', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const result = await service.get('some-key');
      expect(result).toBeNull();
      expect(mockRedisService.get).toHaveBeenCalledWith('some-key');
    });

    it('returns null when redis returns an empty string', async () => {
      mockRedisService.get.mockResolvedValue('');
      const result = await service.get('some-key');
      expect(result).toBeNull();
    });

    it('parses and returns the cached JSON value on a hit', async () => {
      mockRedisService.get.mockResolvedValue(JSON.stringify({ foo: 'bar' }));
      const result = await service.get<{ foo: string }>('some-key');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('propagates a JSON parse error for malformed cached data', async () => {
      mockRedisService.get.mockResolvedValue('{not-json');
      await expect(service.get('some-key')).rejects.toThrow();
    });
  });

  describe('set', () => {
    it('delegates to redisService.set with key, value, and ttl', async () => {
      await service.set('some-key', { foo: 'bar' }, 600);
      expect(mockRedisService.set).toHaveBeenCalledWith('some-key', { foo: 'bar' }, 600);
    });

    it('delegates to redisService.set without a ttl when omitted', async () => {
      await service.set('some-key', { foo: 'bar' });
      expect(mockRedisService.set).toHaveBeenCalledWith('some-key', { foo: 'bar' }, undefined);
    });
  });

  describe('delete', () => {
    it('delegates to redisService.del', async () => {
      await service.delete('some-key');
      expect(mockRedisService.del).toHaveBeenCalledWith('some-key');
    });
  });

  describe('deleteByPattern', () => {
    it('delegates to redisService.delByPattern', async () => {
      await service.deleteByPattern('xvifc:cache:/xvi-fc/*');
      expect(mockRedisService.delByPattern).toHaveBeenCalledWith('xvifc:cache:/xvi-fc/*');
    });

    it('returns the number of keys deleted', async () => {
      mockRedisService.delByPattern.mockResolvedValue(5);
      await expect(service.deleteByPattern('xvifc:cache:/xvi-fc/*')).resolves.toBe(5);
    });
  });
});
