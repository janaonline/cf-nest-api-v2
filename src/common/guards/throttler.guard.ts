import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ThrottlerBehindProxyGuard } from '../../core/guards/throttler-behind-proxy.guard';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerBehindProxyGuard {
  protected throwThrottlingException(_context: ExecutionContext): Promise<void> {
    throw new ThrottlerException('Too many attempts. Please try again in a moment.');
  }
}
