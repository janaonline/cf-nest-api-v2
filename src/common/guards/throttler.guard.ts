import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected throwThrottlingException(_context: ExecutionContext): Promise<void> {
    throw new ThrottlerException('Too many attempts. Please try again in a moment.');
  }
}
