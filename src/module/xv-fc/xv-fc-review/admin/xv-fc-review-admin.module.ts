import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { S3Service } from '../../../../core/s3/s3.service';
import { LedgerLog, LedgerLogSchema } from '../../../../schemas/ledger-log.schema';
import { LineItem, LineItemSchema } from '../../../../schemas/line-item.schema';
import { Year, YearSchema } from '../../../../schemas/year.schema';
import { PtaxReviewAdminModule } from './ptax/ptax-review-admin.module';
import { XvFcReviewAdminController } from './xv-fc-review-admin.controller';
import { XvFcReviewAdminService } from './xv-fc-review-admin.service';

@Module({
  imports: [
    PtaxReviewAdminModule,
    MongooseModule.forFeature([
      { name: LedgerLog.name, schema: LedgerLogSchema },
      { name: LineItem.name, schema: LineItemSchema },
      { name: Year.name, schema: YearSchema },
    ]),
  ],
  controllers: [XvFcReviewAdminController],
  providers: [XvFcReviewAdminService, S3Service],
  exports: [XvFcReviewAdminService],
})
export class XvFcReviewAdminModule {}
