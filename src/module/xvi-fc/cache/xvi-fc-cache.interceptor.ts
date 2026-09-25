import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { XviFcCacheService, XVIFC_CACHE_KEY_PREFIX } from './xvi-fc-cache.service';

export const XVIFC_CACHE_TTL_KEY = 'xvifc_cache_ttl';
export { XVIFC_CACHE_KEY_PREFIX };

/** Apply on any controller method to cache its full response (uses the default 600s TTL). */
// Not currently applied to any route. Commented out rather than deleted — it's broken (raw
// Reflect.metadata only attaches to the (prototype, propertyKey) pair, not the handler function
// reference that Reflector.get(key, context.getHandler()) reads, so the TTL is silently ignored)
// and nothing depends on it. Re-implement with Nest's SetMetadata before using this again.
// export const XviFcCacheTTL = (ttl: number) =>
//   Reflect.metadata(XVIFC_CACHE_TTL_KEY, ttl);

@Injectable()
export class XviFcCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(XviFcCacheInterceptor.name);

  constructor(
    private readonly cache: XviFcCacheService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<{ url: string }>();
    const cacheKey = `${XVIFC_CACHE_KEY_PREFIX}:${request.url}`;

    // A Redis hiccup or corrupted cached value must degrade to a fresh response, never fail
    // the request — caching is an optimization, not something that should be able to take
    // the endpoint down.
    let cached: unknown = null;
    try {
      cached = await this.cache.get<any>(cacheKey);
    } catch (error) {
      this.logger.warn(`Cache read failed for ${cacheKey}; falling back to a fresh response`, error as Error);
    }
    if (cached !== null) return of(cached);

    const ttl = this.reflector.get<number>(XVIFC_CACHE_TTL_KEY, context.getHandler()) ?? 600;

    return next.handle().pipe(
      tap(async (response) => {
        await this.cache.set(cacheKey, response, ttl);
      }),
    );
  }
}
