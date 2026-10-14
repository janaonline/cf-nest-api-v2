import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { State, StateSchema } from 'src/schemas/state.schema';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import {
  ElectedUrbanLocalBodiesForm,
  ElectedUrbanLocalBodiesFormSchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesFormHistory,
  ElectedUrbanLocalBodiesFormHistorySchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form-history.schema';
import {
  ElectedUrbanLocalBodiesRow,
  ElectedUrbanLocalBodiesRowSchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import {
  ElectedUrbanLocalBodiesRowHistory,
  ElectedUrbanLocalBodiesRowHistorySchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row-history.schema';
import { ElectedUrbanLocalBodiesPmuReviewController } from './elected-urban-local-bodies-pmu-review.controller';
import { ElectedUrbanLocalBodiesPmuReviewService } from './services/elected-urban-local-bodies-pmu-review.service';
import { ElectedUrbanLocalBodiesPmuRowsService } from './services/elected-urban-local-bodies-pmu-rows.service';
import { ElectedUrbanLocalBodiesPmuRowReviewDomainService } from './services/elected-urban-local-bodies-pmu-row-review-domain.service';

/** PMU-side review for Elected Urban Local Bodies (PMU Review feature), decoupled from the
 *  State-side module. See this module's own CLAUDE.md for layout. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ElectedUrbanLocalBodiesForm.name, schema: ElectedUrbanLocalBodiesFormSchema },
      { name: ElectedUrbanLocalBodiesFormHistory.name, schema: ElectedUrbanLocalBodiesFormHistorySchema },
      { name: ElectedUrbanLocalBodiesRow.name, schema: ElectedUrbanLocalBodiesRowSchema },
      { name: ElectedUrbanLocalBodiesRowHistory.name, schema: ElectedUrbanLocalBodiesRowHistorySchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: State.name, schema: StateSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
    UlbEligibilityModule,
  ],
  controllers: [ElectedUrbanLocalBodiesPmuReviewController],
  providers: [
    ElectedUrbanLocalBodiesPmuReviewService,
    ElectedUrbanLocalBodiesPmuRowsService,
    ElectedUrbanLocalBodiesPmuRowReviewDomainService,
    EulbFormJsonConfigService,
  ],
  exports: [ElectedUrbanLocalBodiesPmuRowReviewDomainService],
})
export class ElectedUrbanLocalBodiesPmuReviewModule {}
