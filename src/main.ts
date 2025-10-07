import { Logger, ValidationPipe } from '@nestjs/common';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  // Create the main NestJS application instance using the root AppModule
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['log', 'error', 'warn', 'debug', 'verbose'],
    // logger: false, // disable default logger
  });
  const configService = app.get(ConfigService);
  const logger = new Logger('MAIN');

  // Tell Nest where views are stored
  app.setBaseViewsDir(join(__dirname, '..', 'src/views'));
  app.setViewEngine('hbs');

  // Optional: partials/helpers
  // hbs.registerPartials(join(__dirname, '..', 'views/partials'));

  /**
   * -------------------------------------------------------
   * Swagger (OpenAPI) Setup for API Documentation
   * -------------------------------------------------------
   */
  const swaggerConfig = new DocumentBuilder()
    .setTitle('City Finance APIs v2') // Title of the API docs
    .setDescription('V2 documentation.') // Description shown in Swagger UI
    .setVersion('1.0') // API version
    .addServer('/api/v2') // Base path for the APIs
    .build();

  // Generate Swagger document from app's routes and metadata
  const documentFactory = SwaggerModule.createDocument(app, swaggerConfig);

  // Serve Swagger UI at /api-docs
  SwaggerModule.setup('api/v2/api-docs', app, documentFactory);

  /**
   * -------------------------------------------------------
   * Global Validation Pipe
   * -------------------------------------------------------
   * Automatically validates incoming requests based on DTOs.
   *
   * Options used:
   * - whitelist: strips properties that are not part of the DTO
   * - forbidNonWhitelisted: throws error if unknown properties are found
   * - transform: auto-transform payloads to match DTO types
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  /**
   * -------------------------------------------------------
   * CORS (Cross-Origin Resource Sharing) Setup
   * -------------------------------------------------------
   * Allows only whitelisted origins to access the API.
   * - WHITELIST: array of allowed origins
   * - methods: allowed HTTP methods
   * - preflightContinue: whether OPTIONS requests should pass to routes
   * - optionsSuccessStatus: HTTP status for successful OPTIONS response
   * - Note: Comma seperate the domains in .env eg: WHITELISTED_DOMAINS="http://localhost:4200,http://localhost:4100"
   */
  let WHITELISTED_DOMAINS: string[] = [];
  const DOMAINS = configService.get<string>('WHITELISTED_DOMAINS');
  if (DOMAINS) {
    WHITELISTED_DOMAINS = DOMAINS.split(',')
      .map((domain: string) => domain.trim())
      .filter(Boolean);
    // logger.log({ WHITELISTED_DOMAINS });
  } else {
    logger.warn('WHITELISTED_DOMAINS are not available!');
  }

  const corsOptions: CorsOptions = {
    origin: WHITELISTED_DOMAINS,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    optionsSuccessStatus: 204,
  };

  app.enableCors(corsOptions);

  /**
   * -------------------------------------------------------
   * Start the Application
   * -------------------------------------------------------
   * Reads port from environment configuration; defaults to 3000
   */

  app.setGlobalPrefix('api/v2');
  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);
  logger.log(`🚀 Server running on http://localhost:${port}/api/v2/`);
}

bootstrap();
