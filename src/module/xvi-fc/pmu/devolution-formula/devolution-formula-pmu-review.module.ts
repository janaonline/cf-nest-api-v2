import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
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
    ]),
    XviFcCommonModule,
  ],
  controllers: [DevolutionFormulaPmuReviewController],
  providers: [DevolutionFormulaPmuReviewService],
})
export class DevolutionFormulaPmuReviewModule {}
