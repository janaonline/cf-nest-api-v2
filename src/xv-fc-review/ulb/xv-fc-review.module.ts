import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { S3Service } from '../../core/s3/s3.service';
import { S3UploadModule } from '../../s3-upload/s3-upload.module';
import { AnnualAccountData, AnnualAccountDataSchema } from '../../schemas/annual-account-data.schema';
import { LedgerLog, LedgerLogSchema } from '../../schemas/ledger-log.schema';
import { LineItem, LineItemSchema } from '../../schemas/line-item.schema';
import { Year, YearSchema } from '../../schemas/year.schema';
import { PtaxReviewModule } from './ptax/ptax-review.module';
import { XvFcReviewController } from './xv-fc-review.controller';
import { XvFcReviewPdfService } from './xv-fc-review-pdf.service';
import { XvFcReviewService } from './xv-fc-review.service';

@Module({
  imports: [
    S3UploadModule,
    PtaxReviewModule,
    MongooseModule.forFeature([
      { name: LedgerLog.name, schema: LedgerLogSchema },
      { name: LineItem.name, schema: LineItemSchema },
      { name: AnnualAccountData.name, schema: AnnualAccountDataSchema },
      { name: Year.name, schema: YearSchema },
    ]),
  ],
  controllers: [XvFcReviewController],
  providers: [XvFcReviewService, XvFcReviewPdfService, S3Service],
  exports: [XvFcReviewService],
})
export class XvFcReviewModule {}
