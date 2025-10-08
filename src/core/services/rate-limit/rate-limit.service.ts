import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RateLimitService {
  logger = new Logger(RateLimitService.name);
  window = 300; // seconds
  rate_limit = 5; // max requests in window

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async checkLimit(key: string): Promise<void> {
    const current = await this.redis.incr(key);
    if (current === 1) await this.redis.expire(key, this.window);
    this.logger.log(`Rate limit check for ${key}: ${current}/${this.rate_limit} in ${this.window}s`);
    if (current > this.rate_limit) {
      // throw new BadRequestException(`Rate limit exceeded. Please try again after ${this.window}s.`);
      throw new BadRequestException(`Too many attempts. Please try again after ${this.window / 60} minutes.`);
    }
  }
}
