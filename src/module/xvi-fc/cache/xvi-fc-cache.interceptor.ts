import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { XviFcCacheService, XVIFC_CACHE_KEY_PREFIX } from './xvi-fc-cache.service';

export const XVIFC_CACHE_TTL_KEY = 'xvifc_cache_ttl';
export { XVIFC_CACHE_KEY_PREFIX };

/** Apply on any controller method to cache its full response.
 *  Pair with @XviFcCacheTTL(seconds) to override the default 600s TTL. */
export const XviFcCacheTTL = (ttl: number) =>
  Reflect.metadata(XVIFC_CACHE_TTL_KEY, ttl);

@Injectable()
export class XviFcCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly cache: XviFcCacheService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<{ url: string }>();
    const cacheKey = `${XVIFC_CACHE_KEY_PREFIX}:${request.url}`;

    const cached = await this.cache.get<any>(cacheKey);
    if (cached !== null) return of(cached);

    const ttl = this.reflector.get<number>(XVIFC_CACHE_TTL_KEY, context.getHandler()) ?? 600;

    return next.handle().pipe(
      tap(async (response) => {
        await this.cache.set(cacheKey, response, ttl);
      }),
    );
  }
}
