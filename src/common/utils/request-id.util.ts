import { randomUUID } from 'crypto';
import type { Request } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const requestIds = new WeakMap<Request, string>();

export function getOrCreateRequestId(request: Request): string {
  const existing = requestIds.get(request);
  if (existing) return existing;

  const headerValue = request.headers?.[REQUEST_ID_HEADER];
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const requestId =
    typeof candidate === 'string' && SAFE_REQUEST_ID.test(candidate) ? candidate : `req-${randomUUID()}`;

  requestIds.set(request, requestId);
  return requestId;
}
