import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role, User } from '../enum/role.enum';

type AuthenticatedRequest = Request & { user?: User };

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) { }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles =
      this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // this.logger.debug(`Required roles for this route: ${requiredRoles.join(', ')}`, request.user);
    const userRole = request.user?.role;

    if (!userRole) {
      throw new ForbiddenException('User role missing');
    }

    const hasRole = requiredRoles.includes(userRole);
    if (!hasRole) {
      this.logger.warn(
        `Insufficient permissions. Required: ${requiredRoles.join(', ')}, Got: ${userRole}`,
      );
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
