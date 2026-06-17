import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../core/services/redis/redis.service';

export const XVIFC_CACHE_KEY_PREFIX = 'xvifc:cache';

@Injectable()
export class XviFcCacheService {
  constructor(private readonly redisService: RedisService) {}

  async get<T>(key: string): Promise<T | null> {
    const cached = await this.redisService.get(key);
    if (!cached) return null;
    return JSON.parse(cached) as T;
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    await this.redisService.set(key, value, ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.redisService.del(key);
  }

  async deleteByPattern(pattern: string): Promise<void> {
    await this.redisService.delByPattern(pattern);
  }
}
