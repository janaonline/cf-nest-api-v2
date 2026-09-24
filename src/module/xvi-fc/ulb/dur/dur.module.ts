import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { S3Module } from 'src/core/s3/s3.module';
import { S3Service } from 'src/core/s3/s3.service';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';
import { RemindersModule } from 'src/module/xvi-fc/common/reminders/reminders.module';
import { DUR_VALIDATION_QUEUE } from 'src/core/constants/queues';
import { DocumentActionGatesService } from 'src/module/xvi-fc/common/services/document-action-gates.service';
import {
  XviFcDocumentActionGate,
  XviFcDocumentActionGateSchema,
} from 'src/schemas/xvi-fc/document-action-gate.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { User, UserSchema } from 'src/schemas/user/user.schema';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { XviFcDur, XviFcDurSchema } from 'src/schemas/xvi-fc/dur.schema';
import { XviFcDurFormLog, XviFcDurFormLogSchema } from 'src/schemas/xvi-fc/dur-form-log.schema';
import {
  XviFcDurManualReviewRequest,
  XviFcDurManualReviewRequestSchema,
} from 'src/schemas/xvi-fc/dur-manual-review-request.schema';
import { DurController } from './dur.controller';
import { DurService } from './dur.service';
import { DurManualReviewService } from './dur-manual-review.service';
import { DurValidationApiService } from './dur-validation-api.service';
import { DurValidationProcessor } from './dur-validation.processor';
import { DurValidationResultWriter } from './dur-validation-result-writer.service';
import { DurStatusSyncService } from './dur-status-sync.service';

/**
 * ULB + STATE-review slices of DUR (Detailed Utilisation Report) — presign(generic)/confirm-upload/
 * retry/manual-review/submit-to-state (ULB) plus list/decide/undo/bulk-decide/logs (STATE).
 * MoHUA review endpoints are a later phase (not yet built — see project memory on the DUR feature).
 */
@Module({
  imports: [
    HttpModule,
    S3Module,
    FormJsonModule,
    UlbEligibilityModule,
    RemindersModule,
    BullModule.registerQueue({ name: DUR_VALIDATION_QUEUE }),
    MongooseModule.forFeature([
      { name: XviFcDur.name, schema: XviFcDurSchema },
      { name: XviFcDurFormLog.name, schema: XviFcDurFormLogSchema },
      { name: XviFcDurManualReviewRequest.name, schema: XviFcDurManualReviewRequestSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: Year.name, schema: YearSchema },
      { name: User.name, schema: UserSchema },
      { name: XviFcDocumentActionGate.name, schema: XviFcDocumentActionGateSchema },
    ]),
    XviFcCommonModule,
  ],
  controllers: [DurController],
  providers: [
    DurService,
    DurManualReviewService,
    S3Service,
    DurValidationApiService,
    DurValidationResultWriter,
    DurValidationProcessor,
    DurStatusSyncService,
    DocumentActionGatesService,
  ],
  exports: [DurService, DurManualReviewService],
})
export class DurModule {}
