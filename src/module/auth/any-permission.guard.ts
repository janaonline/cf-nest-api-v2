import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ANY_PERMISSIONS_KEY } from './require-permissions.decorator';
import { Permission } from './enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from './permissions.map';

/** Sibling of `PermissionGuard` for endpoints shared by several roles: passes when the user holds any one of the listed permissions. */
@Injectable()
export class AnyPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const anyOf =
      this.reflector.getAllAndOverride<Permission[]>(REQUIRED_ANY_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    if (anyOf.length === 0) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user?.role) throw new ForbiddenException('User role not found');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const effective = getEffectivePermissions(user);
    if (!anyOf.some((permission) => effective.includes(permission))) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
