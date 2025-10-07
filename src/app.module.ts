import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmailModule } from './core/email/email.module';
import { NodeMailerModule } from './core/node-mailer/node-mailer.module';
import { LoggerMiddleware } from './middleware/logger-middleware';
import { ResourcesSectionModule } from './resources-section/resources-section.module';
import { UsersModule } from './users/users.module';
import { ZipModule } from './zip/zip.module';
import { S3Module } from './core/s3/s3.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Async Mongoose config with env
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),
    UsersModule,
    S3Module,
    ZipModule,
    ResourcesSectionModule,
    NodeMailerModule,
    EmailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('/');
  }
}
