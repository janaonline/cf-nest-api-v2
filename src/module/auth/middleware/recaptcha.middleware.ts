import { HttpException, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NextFunction, Request, Response } from 'express';

interface RecaptchaResponse {
  success: boolean;
  score?: number;
  action?: string;
  'error-codes'?: string[];
}

@Injectable()
export class RecaptchaMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RecaptchaMiddleware.name);

  constructor(private readonly configService: ConfigService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const skipDev = this.configService.get<string>('RECAPTCHA_SKIP_DEV');

    if (nodeEnv === 'development' && skipDev === 'true') {
      return next();
    }

    const token = (req.body as Record<string, unknown>)?.recaptchaToken as string | undefined;
    if (!token) {
      throw new HttpException('reCAPTCHA token is required', 422);
    }

    const secret = this.configService.get<string>('RECAPTCHA_SECRET_KEY');
    const minScore = parseFloat(this.configService.get<string>('RECAPTCHA_MIN_SCORE') ?? '0.5');

    try {
      const { data } = await axios.post<RecaptchaResponse>(
        'https://www.google.com/recaptcha/api/siteverify',
        null,
        { params: { secret, response: token, remoteip: req.ip } },
      );

      if (!data.success) {
        this.logger.warn('reCAPTCHA failed', data['error-codes']);
        throw new HttpException('reCAPTCHA verification failed', 401);
      }

      if (data.score !== undefined && data.score < minScore) {
        throw new HttpException('reCAPTCHA score too low: possible bot', 401);
      }

      (req as Request & { recaptchaResult?: unknown }).recaptchaResult = {
        success: data.success,
        score: data.score,
      };

      next();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException('reCAPTCHA service unavailable', 503);
    }
  }
}
