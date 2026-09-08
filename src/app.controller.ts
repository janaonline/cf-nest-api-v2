import { Controller, Get, Logger } from '@nestjs/common';
import { AppService } from './app.service';
import { ConfigService } from '@nestjs/config';
import { Public } from './module/auth/decorators/public.decorator';

@Controller()
export class AppController {
  logger = new Logger(AppController.name);
  constructor(
    private readonly appService: AppService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  getHello(): string {
    const configuredBaseUrl = this.config.get<string>('BASE_URL', '');
    const origin = configuredBaseUrl ? new URL(configuredBaseUrl).origin : '';
    const baseUrl = `${origin}/api/v3/`;
    this.logger.log(`Derived OCR API URL: ${baseUrl}ocr-validation/jobs`);
    return baseUrl;
  }
}
