import { HttpException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {
  handleRequest<T>(err: Error | null, user: T): T {
    if (err || !user) {
      throw new HttpException('Session expired, please login again', 440);
    }
    return user;
  }
}
