import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { XviFcSfcStatus, XviFcSfcStatusSchema } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import { XviFcSfcStatusHistory, XviFcSfcStatusHistorySchema } from 'src/schemas/xvi-fc/state/sfc-status-history.schema';
import { State, StateSchema } from 'src/schemas/state.schema';
import { SfcStatusPmuReviewController } from './sfc-status-pmu-review.controller';
import { SfcStatusPmuReviewService } from './services/sfc-status-pmu-review.service';

/** PMU-side review for SFC Status (PMU Review feature), decoupled from the State-side module. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcSfcStatus.name, schema: XviFcSfcStatusSchema },
      { name: XviFcSfcStatusHistory.name, schema: XviFcSfcStatusHistorySchema },
      { name: State.name, schema: StateSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
  ],
  controllers: [SfcStatusPmuReviewController],
  providers: [SfcStatusPmuReviewService],
})
export class SfcStatusPmuReviewModule {}
