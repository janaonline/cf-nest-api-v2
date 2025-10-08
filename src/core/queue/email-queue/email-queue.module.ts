import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmailModule } from 'src/core/email/email.module';
import { EmailQueueProcessor } from './email-queue.processor';
import { EmailQueueService } from './email-queue.service';
import { SESMailService } from 'src/core/aws-ses/ses.service';
import { EMAIL_QUEUE } from './email-queue.constant';

// @Module({
//   exports: [EmailQueueModule],
//   providers: [EmailQueueModule],
//   imports: [EmailQueueModule],
// })

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({
      name: EMAIL_QUEUE,
      defaultJobOptions: {
        removeOnComplete: { age: 86400, count: 2000 }, // keep for a day or 2k jobs
        removeOnFail: 1000,
        attempts: 1,
      },
    }),
    // EmailModule,
  ],
  //   exports: [BullModule], // Export so other modules can use it
  //   controllers: [ZipController],
  providers: [EmailQueueProcessor, EmailQueueService, SESMailService],
  exports: [EmailQueueService],
})
export class EmailQueueModule {}
