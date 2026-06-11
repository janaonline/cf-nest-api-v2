import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorResponse } from 'src/common/types/api-response.types';

const STATUS_CODE_MAP: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMIT_EXCEEDED',
  500: 'INTERNAL_SERVER_ERROR',
};

/** Shape of a structured object thrown via new HttpException / BadRequestException({ ... }). */
type StructuredHttpExceptionResponse = {
  message?: string | string[];
  error?: string;
  code?: string;
  errors?: unknown;
  details?: unknown;
};

/**
 * Opt-in exception filter that converts any thrown exception into the standard error envelope.
 * Apply via `@ApiEnvelope()` — do NOT register globally.
 *
 * Special cases for 400:
 * - Class-validator arrays → `VALIDATION_FAILED` with message list in `details`.
 * - Data-collection validation objects → `VALIDATION_FAILED` with structured `details`.
 * Unknown errors are returned as `INTERNAL_SERVER_ERROR` without exposing stack traces.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse() as unknown;
      response.status(status).json(this.buildErrorBody(status, res));
    } else {
      const body: ApiErrorResponse = {
        success: false,
        message: 'Internal server error.',
        error: { code: 'INTERNAL_SERVER_ERROR', statusCode: HttpStatus.INTERNAL_SERVER_ERROR },
      };
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
    }
  }

  private buildErrorBody(statusCode: number, res: unknown): ApiErrorResponse {
    const code = this.resolveCode(statusCode, res);
    const message = this.resolveMessage(statusCode, res);
    const details = this.resolveDetails(statusCode, res);
    const errors = this.resolveErrors(res);

    const body: ApiErrorResponse = {
      success: false,
      message,
      error: {
        code,
        statusCode,
        ...(details !== undefined ? { details } : {}),
      },
    };

    if (errors !== undefined) {
      body.errors = errors;
    }

    return body;
  }

  private resolveCode(statusCode: number, res: unknown): string {
    if (typeof res === 'object' && res !== null) {
      const obj = res as Record<string, unknown>;
      if (typeof obj['code'] === 'string') return obj['code'];
      if (statusCode === 400) {
        if (Array.isArray(obj['message'])) return 'VALIDATION_FAILED';
        if ('errors' in obj && obj['success'] === false) return 'VALIDATION_FAILED';
      }
    }
    return STATUS_CODE_MAP[statusCode] ?? 'INTERNAL_SERVER_ERROR';
  }

  private resolveMessage(statusCode: number, res: unknown): string {
    if (statusCode === 400 && typeof res === 'object' && res !== null) {
      const obj = res as Record<string, unknown>;
      if (Array.isArray(obj['message'])) return 'Validation failed.';
      if ('errors' in obj && obj['success'] === false) return 'Financial data validation failed.';
    }
    if (typeof res === 'string') return res;
    if (typeof res === 'object' && res !== null) {
      const obj = res as Record<string, unknown>;
      if (typeof obj['message'] === 'string') return obj['message'];
    }
    return 'An error occurred.';
  }

  private resolveDetails(statusCode: number, res: unknown): unknown {
    if (typeof res !== 'object' || res === null) return undefined;
    const obj = res as Record<string, unknown>;

    if (statusCode === 400) {
      if (Array.isArray(obj['message'])) return obj['message'];
      if ('errors' in obj && obj['success'] === false) {
        const { ulbCode, yearCode, templateVersion, errors, lineItems } = obj;
        return { ulbCode, yearCode, templateVersion, errors, lineItems };
      }
    }

    if (typeof obj['details'] !== 'undefined') return obj['details'];
    return undefined;
  }

  /**
   * Lifts `errors` from a structured service exception to the top-level response body.
   * Excluded cases (handled by resolveDetails instead):
   *   - class-validator: message is string[] → errors go into details
   *   - data-collection: success === false → errors go into details
   */
  private resolveErrors(res: unknown): unknown {
    if (typeof res !== 'object' || res === null) return undefined;
    const obj = res as StructuredHttpExceptionResponse;
    if (!('errors' in obj)) return undefined;
    if (Array.isArray(obj.message)) return undefined;   // class-validator → details path
    if ((obj as Record<string, unknown>)['success'] === false) return undefined; // data-collection → details path
    return obj.errors;
  }
}
