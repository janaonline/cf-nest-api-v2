import { ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  private readonly logger = new Logger(ThrottlerBehindProxyGuard.name);

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    const clientIp = forwarded ? forwarded.split(',')[0].trim() : req.ip;
    // this.logger.debug(`req.ip=${req.ip} | x-forwarded-for=${forwarded ?? 'none'} | tracker=${clientIp}`);
    return clientIp;
  }

  // Plain HttpException (not ThrottlerException) — that class forces its message through a
  // template literal in its constructor, so it can only ever carry a string, never a `code`
  // field for callers to key off of (see forgot-password.component.ts's OTP_COOLDOWN_ACTIVE
  // handling, which relies on other OTP 429s carrying one).
  protected throwThrottlingException(_context: ExecutionContext): Promise<void> {
    throw new HttpException(
      { message: 'Too many attempts. Please try again in a moment.', code: 'IP_RATE_LIMITED' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
