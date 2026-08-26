import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { S3Module } from '../../../../core/s3/s3.module';
import { S3Service } from '../../../../core/s3/s3.service';
import { FileModule } from '../../../file/file.module';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';
import { Ulb, UlbSchema } from '../../../../schemas/ulb.schema';
import { User, UserSchema } from '../../../../schemas/user/user.schema';
import { XviFcAnnualAccount, XviFcAnnualAccountSchema } from '../../../../schemas/xvi-fc/annual-account.schema';
import {
  XviFcAnnualAccountUploadHistory,
  XviFcAnnualAccountUploadHistorySchema,
} from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import {
  XviFcAnnualAccountFormLog,
  XviFcAnnualAccountFormLogSchema,
} from '../../../../schemas/xvi-fc/annual-account-form-log.schema';
import {
  XviFcDocumentActionGate,
  XviFcDocumentActionGateSchema,
} from '../../../../schemas/xvi-fc/document-action-gate.schema';
import {
  XviFcManualReviewRequest,
  XviFcManualReviewRequestSchema,
} from '../../../../schemas/xvi-fc/manual-review-request.schema';
import { AnnualAccountsController } from './annual_accounts.controller';
import { AnnualAccountsService } from './annual_accounts.service';
import { AnnualAccountOcrApiService } from './annual-account-ocr-api.service';
import { AnnualAccountOcrProcessor } from './annual-account-ocr.processor';
import { AnnualAccountStatusSyncService } from './annual-account-status-sync.service';
import { FormJsonModule } from '../../../../master/form-json/form-json.module';
import { EmailQueueModule } from '../../../../core/queue/email-queue/email-queue.module';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';

@Module({
  imports: [
    HttpModule,
    S3Module,
    FileModule,
    FormJsonModule,
    EmailQueueModule,
    UlbEligibilityModule,
    BullModule.registerQueue({ name: ANNUAL_ACCOUNT_PROCESSING_QUEUE }),
    MongooseModule.forFeature([
      { name: XviFcAnnualAccount.name, schema: XviFcAnnualAccountSchema },
      { name: XviFcAnnualAccountUploadHistory.name, schema: XviFcAnnualAccountUploadHistorySchema },
      { name: XviFcAnnualAccountFormLog.name, schema: XviFcAnnualAccountFormLogSchema },
      { name: XviFcDocumentActionGate.name, schema: XviFcDocumentActionGateSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: User.name, schema: UserSchema },
      { name: XviFcManualReviewRequest.name, schema: XviFcManualReviewRequestSchema },
    ]),
  ],
  controllers: [AnnualAccountsController],
  providers: [
    AnnualAccountsService,
    S3Service,
    AnnualAccountOcrApiService,
    AnnualAccountOcrProcessor,
    AnnualAccountStatusSyncService,
  ],
  exports: [AnnualAccountsService],
})
export class AnnualAccountsModule {}
