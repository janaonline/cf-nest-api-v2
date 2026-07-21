import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import {
  XviFcCacheInterceptor,
  XVIFC_CACHE_TTL_KEY,
  XviFcCacheTTL,
  XVIFC_CACHE_KEY_PREFIX,
} from './xvi-fc-cache.interceptor';
import type { XviFcCacheService } from './xvi-fc-cache.service';

function buildContext(url = '/xvi-fc/sidebar/ULB?yearId=year1'): ExecutionContext {
  const handlerFn = function handler() {};
  return {
    switchToHttp: () => ({
      getRequest: () => ({ url }),
    }),
    getHandler: () => handlerFn,
  } as unknown as ExecutionContext;
}

function buildHandler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('XviFcCacheInterceptor', () => {
  let cache: jest.Mocked<Pick<XviFcCacheService, 'get' | 'set'>>;
  let reflector: { get: jest.Mock };
  let interceptor: XviFcCacheInterceptor;

  beforeEach(() => {
    cache = {
      get: jest.fn(),
      set: jest.fn(),
    } as unknown as jest.Mocked<Pick<XviFcCacheService, 'get' | 'set'>>;
    reflector = { get: jest.fn() };
    interceptor = new XviFcCacheInterceptor(cache as unknown as XviFcCacheService, reflector as any);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('exports the expected TTL metadata key', () => {
    expect(XVIFC_CACHE_TTL_KEY).toBe('xvifc_cache_ttl');
  });

  it('re-exports the cache key prefix from the cache service', () => {
    expect(XVIFC_CACHE_KEY_PREFIX).toBe('xvifc:cache');
  });

  describe('cache hit', () => {
    it('returns the cached value without calling next.handle()', async () => {
      cache.get.mockResolvedValue({ cached: true });
      const handler = buildHandler({ cached: false });
      const nextHandleSpy = jest.spyOn(handler, 'handle');

      const result$ = await interceptor.intercept(buildContext(), handler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual({ cached: true });
      expect(nextHandleSpy).not.toHaveBeenCalled();
    });

    it('looks up the cache using the prefixed request url as the key', async () => {
      cache.get.mockResolvedValue({ cached: true });
      const context = buildContext('/xvi-fc/sidebar/ULB?yearId=year1');

      await interceptor.intercept(context, buildHandler(null));

      expect(cache.get).toHaveBeenCalledWith(`${XVIFC_CACHE_KEY_PREFIX}:/xvi-fc/sidebar/ULB?yearId=year1`);
    });
  });

  describe('cache miss', () => {
    it('calls next.handle() and caches the response with the default TTL', async () => {
      cache.get.mockResolvedValue(null);
      reflector.get.mockReturnValue(undefined);
      const handler = buildHandler({ fresh: true });

      const result$ = await interceptor.intercept(buildContext(), handler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual({ fresh: true });
      // tap() runs asynchronously after subscription resolves; flush microtasks.
      await Promise.resolve();
      await Promise.resolve();
      expect(cache.set).toHaveBeenCalledWith(
        `${XVIFC_CACHE_KEY_PREFIX}:/xvi-fc/sidebar/ULB?yearId=year1`,
        { fresh: true },
        600,
      );
    });

    it('uses the TTL from @XviFcCacheTTL metadata when present', async () => {
      cache.get.mockResolvedValue(null);
      reflector.get.mockReturnValue(120);
      const handler = buildHandler({ fresh: true });

      const result$ = await interceptor.intercept(buildContext(), handler);
      await lastValueFrom(result$);
      await Promise.resolve();
      await Promise.resolve();

      expect(cache.set).toHaveBeenCalledWith(expect.any(String), { fresh: true }, 120);
    });

    it('reads TTL metadata using the exported XVIFC_CACHE_TTL_KEY and the handler function', async () => {
      cache.get.mockResolvedValue(null);
      reflector.get.mockReturnValue(undefined);
      const context = buildContext();
      const handlerFn = context.getHandler();

      await interceptor.intercept(context, buildHandler(null));

      expect(reflector.get).toHaveBeenCalledWith(XVIFC_CACHE_TTL_KEY, handlerFn);
    });
  });

  describe('XviFcCacheTTL decorator', () => {
    // NOTE: this decorator is implemented as raw `Reflect.metadata(KEY, ttl)` rather than
    // Nest's `SetMetadata`. Reflect.metadata's decorator only takes (target, propertyKey) and
    // stores metadata keyed by that pair — it does NOT (like SetMetadata does) also write to
    // descriptor.value. Reflector.get(key, context.getHandler()) reads metadata off the handler
    // *function reference*, so metadata attached this way is never visible to the interceptor's
    // reflector.get() call above. Documented here as a pre-existing bug, not fixed per task rules:
    // `@XviFcCacheTTL(n)` silently has no effect and every route falls back to the 600s default.
    class TestTarget {
      method() {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(TestTarget.prototype, 'method')!;

    it('attaches the TTL as metadata on the (prototype, propertyKey) pair', () => {
      XviFcCacheTTL(300)(TestTarget.prototype, 'method', descriptor);
      expect(Reflect.getMetadata(XVIFC_CACHE_TTL_KEY, TestTarget.prototype, 'method')).toBe(300);
    });

    it('BUG: metadata is NOT retrievable off the handler function reference, so Reflector.get(key, context.getHandler()) always misses', () => {
      XviFcCacheTTL(300)(TestTarget.prototype, 'method', descriptor);
      expect(Reflect.getMetadata(XVIFC_CACHE_TTL_KEY, TestTarget.prototype.method)).toBeUndefined();
    });
  });
});
