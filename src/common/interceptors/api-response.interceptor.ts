import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { ApiResponseMeta, ApiSuccessResponse } from 'src/common/types/api-response.types';

/**
 * Opt-in interceptor that wraps controller return values in the standard success envelope.
 * Apply via `@ApiEnvelope()` — do NOT register globally.
 *
 * Wrapping rules (checked in order):
 * 1. Array → `{ data: arr, meta: { count } }`
 * 2. Already fully wrapped (`success + data + message`) → pass through unchanged.
 * 3. Object with `data`, `meta`, or `message` fields → extract those fields.
 * 4. Anything else → wrap as `{ data: result }`.
 */
@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<ApiSuccessResponse> {
    return next.handle().pipe(map((result: unknown) => this.wrap(result)));
  }

  private wrap(result: unknown): ApiSuccessResponse {
    if (Array.isArray(result)) {
      return {
        success: true,
        message: 'Request completed successfully.',
        data: result,
        meta: { count: result.length },
      };
    }

    if (result !== null && typeof result === 'object') {
      const obj = result as Record<string, unknown>;

      // Already fully wrapped — has success, data, and message
      if (obj['success'] === true && 'data' in obj && typeof obj['message'] === 'string') {
        return obj as ApiSuccessResponse;
      }

      // Object with data/meta/message fields — extract and re-wrap
      if ('data' in obj || 'meta' in obj || 'message' in obj) {
        const meta =
          typeof obj['meta'] === 'object' && obj['meta'] !== null ? (obj['meta'] as ApiResponseMeta) : undefined;
        return {
          success: true,
          message: typeof obj['message'] === 'string' ? obj['message'] : 'Request completed successfully.',
          data: 'data' in obj ? obj['data'] : result,
          ...(meta !== undefined ? { meta } : {}),
        };
      }
    }

    return { success: true, message: 'Request completed successfully.', data: result };
  }
}
