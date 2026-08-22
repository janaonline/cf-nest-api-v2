import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ResponseTransformInterceptor } from './response-transform.interceptor';

function buildContext(headers: Record<string, string> = {}, url = '/xvi-fc/state/dashboard'): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ url, headers }),
    }),
  } as unknown as ExecutionContext;
}

function buildHandler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('ResponseTransformInterceptor', () => {
  const interceptor = new ResponseTransformInterceptor();

  it('adds a request ID without replacing an existing XVI-FC timestamp', async () => {
    const timestamp = '2026-07-13T10:00:00.000Z';
    const result = (await lastValueFrom(
      interceptor.intercept(
        buildContext({ 'x-request-id': 'req-123' }),
        buildHandler({ success: true, message: 'ok', data: { value: 1 }, timestamp }),
      ),
    )) as Record<string, unknown>;

    expect(result).toEqual({
      success: true,
      message: 'ok',
      data: { value: 1 },
      timestamp,
      requestId: 'req-123',
    });
  });

  it('does not double-wrap an existing success response', async () => {
    const result = (await lastValueFrom(
      interceptor.intercept(buildContext(), buildHandler({ success: true, message: 'ok', data: { value: 1 } })),
    )) as Record<string, unknown>;

    expect(result['data']).toEqual({ value: 1 });
    expect((result['data'] as Record<string, unknown>)['data']).toBeUndefined();
  });

  it('wraps an unwrapped response with one timestamp and request ID', async () => {
    const result = (await lastValueFrom(
      interceptor.intercept(buildContext({ 'x-request-id': 'req-unwrapped' }), buildHandler({ value: 1 })),
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      success: true,
      data: { value: 1 },
      requestId: 'req-unwrapped',
    });
    expect(typeof result['timestamp']).toBe('string');
  });

  it('generates a request ID when the incoming header is missing', async () => {
    const result = (await lastValueFrom(
      interceptor.intercept(buildContext(), buildHandler({ success: true, data: null })),
    )) as Record<string, unknown>;

    expect(result['requestId']).toMatch(/^req-/);
  });

  it('rejects unsafe incoming request IDs and generates a safe value', async () => {
    const result = (await lastValueFrom(
      interceptor.intercept(
        buildContext({ 'x-request-id': '<script>unsafe</script>' }),
        buildHandler({ success: true, data: null }),
      ),
    )) as Record<string, unknown>;

    expect(result['requestId']).toMatch(/^req-/);
    expect(result['requestId']).not.toBe('<script>unsafe</script>');
  });
});
