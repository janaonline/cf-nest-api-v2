import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
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
import { FcUnspentMohuaReviewController } from './fc-unspent-mohua-review.controller';
import { FcUnspentMohuaReviewService } from './services/fc-unspent-mohua-review.service';
import { FcUnspentMohuaRowsService } from './services/fc-unspent-mohua-rows.service';
import { FcUnspentRowReviewDomainService } from './services/fc-unspent-row-review-domain.service';

/** MoHUA-side review for FC Unspent Declaration, decoupled from the State-side module. See
 *  CLAUDE.md's intro and "Layout" section for why and what each file here owns. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcUnspentStateForm.name, schema: XviFcUnspentStateFormSchema },
      { name: XviFcUnspentStateFormHistory.name, schema: XviFcUnspentStateFormHistorySchema },
      { name: XviFcUnspentStateFormRow.name, schema: XviFcUnspentStateFormRowSchema },
      { name: XviFcUnspentStateFormRowHistory.name, schema: XviFcUnspentStateFormRowHistorySchema },
    ]),
    XviFcCommonModule,
  ],
  controllers: [FcUnspentMohuaReviewController],
  providers: [FcUnspentMohuaReviewService, FcUnspentMohuaRowsService, FcUnspentRowReviewDomainService],
  exports: [FcUnspentRowReviewDomainService],
})
export class FcUnspentMohuaReviewModule {}
