import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

/**
 * Shared no-TTL, domain-key cache helper — the pattern FormJsonService and SideMenuService both
 * use: a key built from domain values (never the request URL, never dependent on route prefixes),
 * cached forever, invalidated explicitly by whichever write path changed the underlying data.
 * Read, write, and invalidate all go through the SAME key-builder here, so they can't drift apart
 * the way the side-menu's old URL-keyed cache once did (see git history for that bug).
 */
@Injectable()
export class NamespacedCacheService {
  /** Namespaces cache keys per environment; dev and stg share the same Redis instance. */
  private readonly env: string;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.env = config.get<string>('NODE_ENV') ?? 'production';
  }

  /** Builds `<namespace>:<env>:<part1>:<part2>:...`. */
  buildKey(namespace: string, ...parts: Array<string | number>): string {
    return [namespace, this.env, ...parts].join(':');
  }

  /** Same shape as buildKey, but a part left `undefined` becomes `*` for pattern-based clearing. */
  buildPattern(namespace: string, ...parts: Array<string | number | undefined>): string {
    return [namespace, this.env, ...parts.map((p) => p ?? '*')].join(':');
  }

  async get<T>(key: string): Promise<T | null> {
    const cached = await this.redis.get(key);
    return cached !== null ? (JSON.parse(cached) as T) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.redis.set(key, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /** Returns how many cache keys were actually deleted, so callers can tell a real clear from a no-op. */
  async delByPattern(pattern: string): Promise<number> {
    return this.redis.delByPattern(pattern);
  }
}
