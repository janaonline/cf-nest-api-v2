import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { ApiClientContext } from '../types/api-client-context.type';

export const CurrentApiClient = createParamDecorator((_: unknown, ctx: ExecutionContext): ApiClientContext => {
  const request = ctx.switchToHttp().getRequest<{ apiClient?: ApiClientContext }>();
  if (!request.apiClient) {
    throw new InternalServerErrorException(
      'ApiClient context not found on request. Ensure IntegrationJwtGuard is applied.',
    );
  }
  return request.apiClient;
});
