import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { FcUnspentDeclarationFormJsonService } from 'src/module/xvi-fc/state/fc-unspent-declaration/services/form-json/fc-unspent-declaration-form-json.service';
import {
  XviFcUnspentStateForm,
  XviFcUnspentStateFormSchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import {
  XviFcUnspentStateFormHistory,
  XviFcUnspentStateFormHistorySchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-history.schema';
import {
  XviFcUnspentStateFormRow,
  XviFcUnspentStateFormRowSchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import {
  XviFcUnspentStateFormRowHistory,
  XviFcUnspentStateFormRowHistorySchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row-history.schema';
import { State, StateSchema } from 'src/schemas/state.schema';
import { FcUnspentPmuReviewController } from './fc-unspent-pmu-review.controller';
import { FcUnspentPmuReviewService } from './services/fc-unspent-pmu-review.service';
import { FcUnspentPmuRowsService } from './services/fc-unspent-pmu-rows.service';
import { FcUnspentPmuRowReviewDomainService } from './services/fc-unspent-pmu-row-review-domain.service';

/** PMU-side review for FC Unspent Declaration, decoupled from the State-side module; MoHUA's own
 *  module (`mohua/fc-unspent-declaration`) is untouched. See this module's CLAUDE.md for layout and
 *  the "PMU vs MoHUA" section for how the two relate. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcUnspentStateForm.name, schema: XviFcUnspentStateFormSchema },
      { name: XviFcUnspentStateFormHistory.name, schema: XviFcUnspentStateFormHistorySchema },
      { name: XviFcUnspentStateFormRow.name, schema: XviFcUnspentStateFormRowSchema },
      { name: XviFcUnspentStateFormRowHistory.name, schema: XviFcUnspentStateFormRowHistorySchema },
      { name: State.name, schema: StateSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
  ],
  controllers: [FcUnspentPmuReviewController],
  providers: [
    FcUnspentPmuReviewService,
    FcUnspentPmuRowsService,
    FcUnspentPmuRowReviewDomainService,
    FcUnspentDeclarationFormJsonService,
  ],
  exports: [FcUnspentPmuRowReviewDomainService],
})
export class FcUnspentPmuReviewModule {}
