import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EMAIL_QUEUE } from 'src/core/queue/email-queue/email-queue.constant';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { EmailList, EmailListSchema } from 'src/schemas/email-list';
import { ReportAnIssue, ReportAnIssueSchema } from 'src/schemas/report-an-issue.schema';
import { ExcelService } from 'src/services/excel/excel.service';
import { ReportAnIssueController } from './report-an-issue.controller';
import { ReportAnIssueService } from './report-an-issue.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReportAnIssue.name, schema: ReportAnIssueSchema },
      { name: EmailList.name, schema: EmailListSchema },
    ]),
    BullModule.registerQueue({
      name: EMAIL_QUEUE,
      defaultJobOptions: {
        removeOnComplete: { age: 86400, count: 2000 },
        removeOnFail: 1000,
        attempts: 1,
      },
    }),
  ],

  controllers: [ReportAnIssueController],
  providers: [ExcelService, EmailQueueService, ReportAnIssueService],
})
export class ReportAnIssueModule {}
