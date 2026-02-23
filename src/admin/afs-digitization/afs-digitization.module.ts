import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AfsExcelFile, AfsExcelFileSchema } from 'src/schemas/afs/afs-excel-file.schema';
import { AnnualAccountData, AnnualAccountDataSchema } from 'src/schemas/annual-account-data.schema';
import { DigitizationLog, DigitizationLogSchema } from 'src/schemas/digitization-log.schema';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { AfsDigitizationController } from './afs-digitization.controller';
import { AfsDigitizationService } from './afs-digitization.service';
import { AfsDumpService } from './afs-dump.service';
import { BullModule } from '@nestjs/bullmq';
import { DigitizationQueueService } from './queue/digitization-queue/digitization-queue.service';
import { DigitizationProcessor } from './queue/digitization.processor';
import { HttpModule } from '@nestjs/axios';
import { S3Module } from 'src/core/s3/s3.module';
import { S3Service } from 'src/core/s3/s3.service';
import { AfsMetric, AfsMetricSchema } from 'src/schemas/afs/afs-metrics.schema';
import { BullBoardModule } from '@bull-board/nestjs/dist/bull-board.module';
import { ExpressAdapter } from '@bull-board/express/dist/ExpressAdapter';
import { BullMQAdapter } from '@bull-board/api/dist/queueAdapters/bullMQ.js';
import basicAuth from 'express-basic-auth';
import { ConfigService } from '@nestjs/config';
import { EMAIL_QUEUE } from 'src/core/queue/email-queue/email-queue.constant';
import { AFS_AUDITORS_REPORT_QUEUE, AFS_DIGITIZATION_QUEUE, ZIP_RESOURCES_QUEUE } from 'src/core/constants/queues';
import { AfsAuditorsReport, AfsAuditorsReportSchema } from 'src/schemas/afs/afs-auditors-report.schema';
import { AuditorsReportOcrQueueService } from './queue/auditors-report-ocr-queue/auditors-report-ocr-queue.service';
import { AuditorsReportOcrProcessor } from './queue/auditors-report-ocr.processor';

@Module({
  imports: [
    HttpModule,
    S3Module,
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
      { name: AfsExcelFile.name, schema: AfsExcelFileSchema },
      { name: AnnualAccountData.name, schema: AnnualAccountDataSchema },
      { name: AfsAuditorsReport.name, schema: AfsAuditorsReportSchema },
      { name: AfsMetric.name, schema: AfsMetricSchema },
    ]),
    MongooseModule.forFeature([{ name: DigitizationLog.name, schema: DigitizationLogSchema }], 'digitization_db'),
    BullModule.registerQueue(
      {
        name: AFS_DIGITIZATION_QUEUE,
      },
      {
        name: AFS_AUDITORS_REPORT_QUEUE,
      },
    ),
    // Queue UI
    BullBoardModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        route: '/admin/queues',
        adapter: ExpressAdapter,
        middleware: basicAuth({
          challenge: true,
          users: {
            [cfg.get<string>('ADMIN_USER')!]: cfg.get<string>('ADMIN_PASSWORD')!,
          },
        }),
      }),
    }),
    BullBoardModule.forFeature(
      { name: AFS_DIGITIZATION_QUEUE, adapter: BullMQAdapter },
      { name: AFS_AUDITORS_REPORT_QUEUE, adapter: BullMQAdapter },
      { name: ZIP_RESOURCES_QUEUE, adapter: BullMQAdapter },
      { name: EMAIL_QUEUE, adapter: BullMQAdapter },
    ),
  ],
  controllers: [AfsDigitizationController],
  providers: [
    AfsDigitizationService,
    AfsDumpService,
    DigitizationQueueService,
    DigitizationProcessor,
    AuditorsReportOcrProcessor,
    AuditorsReportOcrQueueService,
    S3Service,
  ],
})
export class AfsDigitizationModule {}
