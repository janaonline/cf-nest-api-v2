import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RateLimitService {
  window = 60; // seconds
  rate_limit = 5; // max requests in window

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async checkLimit(key: string): Promise<void> {
    const current = await this.redis.incr(key);
    if (current === 1) await this.redis.expire(key, this.window);

    if (current > this.rate_limit) {
      throw new BadRequestException(`Rate limit exceeded. Please try again after ${this.window}s.`);
    }
  }
}
