import { BadRequestException } from '@nestjs/common';
import type { XviFcApiResponse, XviFcValidationErrorMap } from './xvi-fc-api-response';

/** Builds a successful XVI-FC API response. Passes through the global ResponseTransformInterceptor unchanged due to the `success` key. */
export function xviFcSuccess<T>(message: string, data: T, meta?: Record<string, unknown>): XviFcApiResponse<T> {
  const response: XviFcApiResponse<T> = { success: true, message, data, timestamp: new Date().toISOString() };
  if (meta) response.meta = meta;
  return response;
}

/**
 * Throws a BadRequestException whose body is picked up by HttpExceptionFilter.
 * The filter forwards `message` and `errors` into the error response body.
 * Errors are keyed by field key for O(1) frontend access; use `_form` for non-field errors.
 */
export function throwXviFcValidationError(errors: XviFcValidationErrorMap): never {
  throw new BadRequestException({ message: 'Validation failed.', errors });
}

/**
 * Like throwXviFcValidationError but also includes a `data` payload in the 400 body.
 * Used when validation fails but the backend has already persisted partial state that
 * the frontend needs (e.g., validationSummary after a ulbCount mismatch).
 */
export function throwXviFcValidationErrorWithData(errors: XviFcValidationErrorMap, data: unknown): never {
  throw new BadRequestException({ message: 'Validation failed.', errors, data });
}
