import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { Redis as RedisClient } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClient;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST'),
      port: this.config.get<number>('REDIS_PORT'),
      password: this.config.get<string>('REDIS_PASSWORD'),
    });
    // const redisUrl = this.config.get<string>('REDIS_URL');
    // this.client = new Redis(redisUrl);
    this.client.on('connect', () => {
      console.log('Connected to Redis');
    });
    this.client.on('error', (err) => {
      console.error('Redis error:', err);
    });
  }

  onModuleDestroy() {
    this.client.quit();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    const data = typeof value === 'string' ? value : JSON.stringify(value);
    ttl ? await this.client.set(key, data, 'EX', ttl) : await this.client.set(key, data);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttl: number): Promise<void> {
    await this.client.expire(key, ttl);
  }
}
