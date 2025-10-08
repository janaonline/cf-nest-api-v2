// zip-jobs.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ZipController } from './zip.controller';
import { ZipJobsProcessor } from './zip-jobs.processor';
import { ZipBuildService } from './zip.service';
import { MailerService } from './mailer.service';
import { EmailModule } from 'src/core/email/email.module';
import { SESMailService } from 'src/core/aws-ses/ses.service';
import { S3Service } from 'src/core/s3/s3.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      useFactory: (cfg: ConfigService) => {
        const redisUrl = cfg.get<string>('REDIS_URL');
        if (!redisUrl) {
          throw new Error('REDIS_URL is not defined in configuration');
        }
        // Parse REDIS_URL to ConnectionOptions if needed, or use as host string
        // Example for simple host:port
        return {
          connection: { url: redisUrl },
          // optional: shared bullmq options here
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'zip',
      defaultJobOptions: {
        removeOnComplete: { age: 86400, count: 2000 }, // keep for a day or 2k jobs
        removeOnFail: 1000,
        attempts: 1,
      },
    }),
    EmailModule,
  ],
  exports: [BullModule], // Export so other modules can use it
  controllers: [ZipController],
  providers: [ZipJobsProcessor, S3Service, ZipBuildService, MailerService, SESMailService],
})
export class ZipModule {}
