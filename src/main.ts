import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  // Create the main NestJS application instance using the root AppModule
  const app = await NestFactory.create(AppModule);

  /**
   * -------------------------------------------------------
   * Swagger (OpenAPI) Setup for API Documentation
   * -------------------------------------------------------
   */
  const swaggerConfig = new DocumentBuilder()
    .setTitle('City Finance APIs') // Title of the API docs
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
   * Start the Application
   * -------------------------------------------------------
   * Reads port from environment configuration; defaults to 3000
   */

  app.setGlobalPrefix('api/v2');

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;

  await app.listen(port);

  console.log(`🚀 Server running on http://localhost:${port}`);
}

bootstrap();

// TODO - To be removed.
// async function bootstrap() {
//   const app = await NestFactory.create(AppModule);

//   const swaggerConfig = new DocumentBuilder()
//     .setTitle('City Finance APIs')
//     .setDescription('V2 documentation.')
//     .setVersion('1.0')
//     .build();
//   const documentFactory = SwaggerModule.createDocument(app, swaggerConfig);
//   SwaggerModule.setup('api', app, documentFactory);

//   const configService = app.get(ConfigService);
//   const port = configService.get<number>('PORT') || 3000;

//   await app.listen(port);

//   console.log(`🚀 Server running on http://localhost:${port}`);
// }
// bootstrap();
