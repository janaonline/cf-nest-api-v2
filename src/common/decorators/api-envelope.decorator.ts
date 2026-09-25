import { UseFilters, UseInterceptors, applyDecorators } from '@nestjs/common';
import { ApiExceptionFilter } from 'src/common/filters/api-exception.filter';
import { ApiResponseInterceptor } from 'src/common/interceptors/api-response.interceptor';

/**
 * Opt-in class decorator that applies `ApiResponseInterceptor` and `ApiExceptionFilter`
 * to a controller, wrapping all responses and errors in the standard API envelope.
 * Do NOT use globally — apply only to integration/data-collection controllers.
 */
export function ApiEnvelope() {
  return applyDecorators(UseInterceptors(ApiResponseInterceptor), UseFilters(ApiExceptionFilter));
}
