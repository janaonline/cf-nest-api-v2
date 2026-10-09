import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { XviFcGtc, XviFcGtcSchema } from 'src/schemas/xvi-fc/state/gtc-form.schema';
import { XviFcGtcHistory, XviFcGtcHistorySchema } from 'src/schemas/xvi-fc/state/gtc-form-history.schema';
import { State, StateSchema } from 'src/schemas/state.schema';
import { GtcPmuReviewController } from './gtc-pmu-review.controller';
import { GtcPmuReviewService } from './services/gtc-pmu-review.service';

/** PMU-side review for GTC (PMU Review feature), decoupled from the State-side module. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcGtc.name, schema: XviFcGtcSchema },
      { name: XviFcGtcHistory.name, schema: XviFcGtcHistorySchema },
      { name: State.name, schema: StateSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
  ],
  controllers: [GtcPmuReviewController],
  providers: [GtcPmuReviewService],
})
export class GtcPmuReviewModule {}
