import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  private readonly logger = new Logger(ThrottlerBehindProxyGuard.name);

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    const clientIp = forwarded ? forwarded.split(',')[0].trim() : req.ip;
    // this.logger.debug(`req.ip=${req.ip} | x-forwarded-for=${forwarded ?? 'none'} | tracker=${clientIp}`);
    return clientIp;
  }

  protected throwThrottlingException(_context: ExecutionContext): Promise<void> {
    throw new ThrottlerException('Too many attempts. Please try again in a moment.');
  }
}
