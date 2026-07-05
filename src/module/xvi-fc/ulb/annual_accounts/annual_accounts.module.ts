import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { S3Module } from '../../../../core/s3/s3.module';
import { S3Service } from '../../../../core/s3/s3.service';
import { S3UploadModule } from '../../../../s3-upload/s3-upload.module';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';
import { Ulb, UlbSchema } from '../../../../schemas/ulb.schema';
import { XviFcAnnualAccount, XviFcAnnualAccountSchema } from '../../../../schemas/xvi-fc/annual-account.schema';
import {
  XviFcAnnualAccountUploadHistory,
  XviFcAnnualAccountUploadHistorySchema,
} from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { AnnualAccountsController } from './annual_accounts.controller';
import { AnnualAccountsService } from './annual_accounts.service';
import { AnnualAccountOcrApiService } from './annual-account-ocr-api.service';
import { AnnualAccountOcrProcessor } from './annual-account-ocr.processor';
import { AnnualAccountStatusSyncService } from './annual-account-status-sync.service';
import { FormJsonModule } from '../../../../form-json/form-json.module';

@Module({
  imports: [
    HttpModule,
    S3Module,
    S3UploadModule,
    FormJsonModule,
    BullModule.registerQueue({ name: ANNUAL_ACCOUNT_PROCESSING_QUEUE }),
    MongooseModule.forFeature([
      { name: XviFcAnnualAccount.name, schema: XviFcAnnualAccountSchema },
      { name: XviFcAnnualAccountUploadHistory.name, schema: XviFcAnnualAccountUploadHistorySchema },
      { name: Ulb.name, schema: UlbSchema },
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
