import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SCOPES_KEY } from '../decorators/scopes.decorator';
import type { ApiClientContext } from '../types/api-client-context.type';

type RequestWithApiClient = { apiClient?: ApiClientContext };

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [context.getHandler(), context.getClass()]);

    // No scopes declared on route — allow through
    if (!required || required.length === 0) return true;

    const { apiClient } = context.switchToHttp().getRequest<RequestWithApiClient>();
    const clientScopes = new Set(apiClient?.scopes ?? []);

    if (!required.every((s) => clientScopes.has(s))) {
      throw new ForbiddenException('Insufficient scope');
    }

    return true;
  }
}
