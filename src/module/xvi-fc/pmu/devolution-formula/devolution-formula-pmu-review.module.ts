import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { DfFormJsonConfigService } from 'src/module/xvi-fc/state/devolution-formula/services/form-json/devolution-formula-form-json.service';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormSchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaFormHistory,
  DevolutionFormulaFormHistorySchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-form-history.schema';
import {
  DevolutionFormulaRow,
  DevolutionFormulaRowSchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { State, StateSchema } from 'src/schemas/state.schema';
import { DevolutionFormulaPmuReviewController } from './devolution-formula-pmu-review.controller';
import { DevolutionFormulaPmuReviewService } from './services/devolution-formula-pmu-review.service';

/** PMU-side review for Devolution Formula (PMU Review feature), decoupled from the State-side
 *  module. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DevolutionFormulaForm.name, schema: DevolutionFormulaFormSchema },
      { name: DevolutionFormulaFormHistory.name, schema: DevolutionFormulaFormHistorySchema },
      { name: DevolutionFormulaRow.name, schema: DevolutionFormulaRowSchema },
      { name: State.name, schema: StateSchema },
      { name: Ulb.name, schema: UlbSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
    UlbEligibilityModule,
  ],
  controllers: [DevolutionFormulaPmuReviewController],
  providers: [DevolutionFormulaPmuReviewService, DfFormJsonConfigService],
})
export class DevolutionFormulaPmuReviewModule {}
