import type { Request } from 'express';
import { getOrCreateRequestId } from './request-id.util';

function makeRequest(requestId?: string): Request {
  return { headers: requestId === undefined ? {} : { 'x-request-id': requestId } } as unknown as Request;
}

describe('getOrCreateRequestId', () => {
  it('preserves a valid incoming request ID', () => {
    expect(getOrCreateRequestId(makeRequest('req-client-123'))).toBe('req-client-123');
  });

  it('generates a request ID when the header is missing', () => {
    expect(getOrCreateRequestId(makeRequest())).toMatch(/^req-/);
  });

  it('generates a request ID when the header is blank', () => {
    expect(getOrCreateRequestId(makeRequest(''))).toMatch(/^req-/);
  });

  it('rejects an unsafe incoming request ID', () => {
    expect(getOrCreateRequestId(makeRequest('<script>unsafe</script>'))).toMatch(/^req-/);
  });

  it('rejects an incoming request ID longer than 128 characters', () => {
    expect(getOrCreateRequestId(makeRequest(`req-${'a'.repeat(129)}`))).toMatch(/^req-[0-9a-f-]{36}$/);
  });

  it('prefixes generated IDs with req-', () => {
    expect(getOrCreateRequestId(makeRequest())).toMatch(/^req-[0-9a-f-]{36}$/);
  });

  it('returns the same request ID when the same request is read again', () => {
    const request = makeRequest();
    expect(getOrCreateRequestId(request)).toBe(getOrCreateRequestId(request));
  });
});
