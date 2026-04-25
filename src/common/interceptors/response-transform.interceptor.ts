import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

const AUTH_FLATTEN_PATHS = ['/login', '/refresh', '/verifyOtp'];

@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const url = request.url;

    const shouldFlatten = AUTH_FLATTEN_PATHS.some((p) => url.includes(p));

    return next.handle().pipe(
      map((data: unknown) => {
        if (data !== null && typeof data === 'object' && 'success' in (data as object)) {
          return data;
        }

        const timestamp = new Date().toISOString();

        if (shouldFlatten && data !== null && typeof data === 'object') {
          const obj = data as Record<string, unknown>;
          if ('token' in obj) {
            return { success: true, token: obj['token'], user: obj['user'], timestamp };
          }
        }

        return { success: true, data, timestamp };
      }),
    );
  }
}
