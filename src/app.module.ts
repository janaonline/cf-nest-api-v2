import { CacheModule } from '@nestjs/cache-manager';
import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmailModule } from './core/email/email.module';
import { NodeMailerModule } from './core/node-mailer/node-mailer.module';
import { RedisModule } from './core/services/redis/redis.module';
import { LoggerMiddleware } from './middleware/logger-middleware';
import { AuthModule } from './module/auth/auth.module';
import { UsersModule } from './users/users.module';
import { AfsDigitizationModule } from './admin/afs-digitization/afs-digitization.module';
import { ReportAnIssueModule } from './web/report-an-issue/report-an-issue.module';
import { ResourcesSectionModule } from './web/resources-section/resources-section.module';
import { EventsModule } from './admin/events/events.module';

function getQueryCaller(): string {
  const stack = new Error().stack?.split('\n') ?? [];
  const frame = stack.find(
    (line) => line.includes('src') && !line.includes('node_modules') && !line.includes('app.module'),
  );
  const match = frame?.match(/\((.+?)\)/) ?? frame?.match(/at (.+)/);
  return match?.[1]?.trim() ?? 'unknown';
}

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: seconds(60), // time window in seconds
        limit: 60, // max requests per window
      },
    ]),
    ConfigModule.forRoot({ isGlobal: true }),
    CacheModule.register({ isGlobal: true, ttl: 300000 }),
    RedisModule,
    AuthModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const redisUrl = cfg.get<string>('REDIS_URL');
        if (!redisUrl) throw new Error('REDIS_URL missing');
        return {
          connection: { url: redisUrl }, // supports redis:// and rediss://
          prefix: 'appq', // optional key prefix
        };
      },
    }),
    // Async Mongoose config with env
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
        // connectionFactory: (connection: any) => {
        //   connection.set('debug', (collection: string, method: string, ...args: any[]) => {
        //     const caller = getQueryCaller();
        //     console.log(`[Query] ${collection}.${method} | ${caller}`, JSON.stringify(args));
        //   });
        //   return connection;
        // },
      }),
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI_2'),
        // connectionFactory: (connection: any) => {
        //   connection.set('debug', (collection: string, method: string, ...args: any[]) => {
        //     const caller = getQueryCaller();
        //     console.log(`[Query:digitization_db] ${collection}.${method} | ${caller}`, JSON.stringify(args));
        //   });
        //   return connection;
        // },
      }),
      connectionName: 'digitization_db',
    }),
    UsersModule,
    ResourcesSectionModule,
    NodeMailerModule,
    EmailModule,
    ReportAnIssueModule,
    AfsDigitizationModule,
    EventsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('/');
  }
}
