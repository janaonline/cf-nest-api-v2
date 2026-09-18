import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { S3Service } from '../../../../core/s3/s3.service';
import { LedgerLog, LedgerLogSchema } from '../../../../schemas/ledger-log.schema';
import { LineItem, LineItemSchema } from '../../../../schemas/line-item.schema';
import { Ulb, UlbSchema } from '../../../../schemas/ulb.schema';
import { XvFcPtaxReview, XvFcPtaxReviewSchema } from '../../../../schemas/xv-fc-ptax-review.schema';
import { Year, YearSchema } from '../../../../schemas/year.schema';
import { PtaxReviewAdminModule } from './ptax/ptax-review-admin.module';
import { XvFcReviewOverviewController } from './overview/xv-fc-review-overview.controller';
import { XvFcReviewOverviewService } from './overview/xv-fc-review-overview.service';
import { XvFcReviewAdminController } from './xv-fc-review-admin.controller';
import { XvFcReviewAdminService } from './xv-fc-review-admin.service';

/**
 * XvFcReviewOverviewController is declared directly in THIS module's `controllers` array
 * (rather than living in its own imported module), listed BEFORE XvFcReviewAdminController.
 * Both controllers share the `admin/xv-fc-review` base path, and XvFcReviewAdminController's
 * `GET :ulbId/:yearId` wildcard route would otherwise shadow the overview controller's literal
 * `GET overview/analytics` / `GET overview/export` routes — Express matches whichever route was
 * registered first, treating "overview" as ulbId and "analytics"/"export" as yearId, which fails
 * ParseObjectIdPipe with "Invalid yearId". Nest mounts routes within a single module's own
 * `controllers` array strictly in declaration order (same mechanism already relied on for
 * `:ulbId/years` vs `:ulbId/:yearId` in xv-fc-review-admin.controller.ts), so listing Overview
 * first here is what actually guarantees it wins — module import order alone isn't reliable for
 * this across controllers in different modules.
 */
@Module({
  imports: [
    PtaxReviewAdminModule,
    MongooseModule.forFeature([
      { name: LedgerLog.name, schema: LedgerLogSchema },
      { name: LineItem.name, schema: LineItemSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: XvFcPtaxReview.name, schema: XvFcPtaxReviewSchema },
      { name: Year.name, schema: YearSchema },
    ]),
  ],
  controllers: [XvFcReviewOverviewController, XvFcReviewAdminController],
  providers: [XvFcReviewAdminService, XvFcReviewOverviewService, S3Service],
  exports: [XvFcReviewAdminService],
})
export class XvFcReviewAdminModule {}
