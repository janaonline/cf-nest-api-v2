import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role, User } from '../enum/role.enum';
import { AuthService } from '../auth.service';

type AuthenticatedRequest = Request & {
  user?: User;
};

@Injectable()
export class RolesGuard implements CanActivate {
  logger = new Logger(RolesGuard.name);

  constructor(
    private jwtService: JwtService,
    private authService: AuthService,
    private reflector: Reflector,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Allow access if the route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // if (request.method === 'OPTIONS') {
    //   return true;
    // }

    // Read required roles from metadata
    const requiredRoles =
      this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    // Extract token
    const token = this.extractTokenFromRequest(request);
    if (!token) {
      this.logger.warn('Please provide a token!');
      throw new UnauthorizedException('Authentication token missing');
    }

    // Verify token & attach user to request
    let payload: User;
    try {
      payload = await this.jwtService.verifyAsync(token);
      // Fetch user details and attach to request
      const user = await this.authService.getUserById(payload._id);
      if (!user) {
        this.logger.warn(`User not found for ID: ${payload._id}`);
        throw new UnauthorizedException('User not found');
      }
      request.user = {
        ...payload,
        ...user.toObject(),
      } as unknown as AuthenticatedRequest['user'];

      // this.logger.debug(`Authenticated user:`, user);
      // request['user'] = payload;
    } catch (error) {
      this.logger.warn('JWT verification failed', error);
      throw new UnauthorizedException('Invalid token');
    }

    // Role check (if roles are defined)
    if (requiredRoles.length > 0) {
      const userRole = request.user?.role;
      if (!userRole) {
        throw new UnauthorizedException('User role missing');
      }
      const hasRole = requiredRoles.includes(userRole);
      if (!hasRole) {
        this.logger.warn(
          `Insufficient permissions. Allowed roles: ${requiredRoles.join(', ')}, Provided roles: ${userRole}`,
        );
        throw new ForbiddenException('Insufficient permissions');
      }
    }
    return true;
  }

  /**
   * Extracts an authentication token from an incoming HTTP request.
   *
   * Token resolution order (highest -> lowest priority):
   * 1. Authorization header (Bearer token)
   * 2. x-access-token header
   * 3. Request body token (Commented)
   * 4. Query string token (Commented)
   * 5. Route params token (Commented)
   *
   * Returns `undefined` if no token is found.
   */
  private extractTokenFromRequest(req: Request): undefined | string {
    // 1. Authorization header
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string') {
      const [schema, token] = authHeader.split(' ');
      if (schema === 'Bearer' && token) {
        return token;
      }
    }

    // 2. x-access-token
    const xAccessToken = req.headers['x-access-token'];
    if (typeof xAccessToken === 'string') {
      return xAccessToken;
    }

    // 3. Optional fallbacks
    // if (typeof req.body?.token === 'string') {
    //   return req.body.token;
    // }
    //
    // if (typeof req.query?.token === 'string') {
    //   return req.query.token;
    // }
    //
    // if (typeof req.params?.token === 'string') {
    //   return req.params.token;
    // }

    return undefined;
  }
}
