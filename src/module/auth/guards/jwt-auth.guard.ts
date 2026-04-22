import { ExecutionContext, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<T>(err: Error | null, user: T, info: { name?: string } | null): T {
    if (info?.name === 'TokenExpiredError') {
      throw new HttpException('Token expired', 401);
    }
    if (info?.name === 'JsonWebTokenError') {
      throw new HttpException('Invalid token', 401);
    }
    if (err || !user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
