import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import {
  XviFcEligibilityExemption,
  XviFcEligibilityExemptionSchema,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import {
  XviFcEligibilityExemptionFormLog,
  XviFcEligibilityExemptionFormLogSchema,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption-form-log.schema';
import { XviFcAnnualAccount, XviFcAnnualAccountSchema } from 'src/schemas/xvi-fc/annual-account.schema';
import { XviFcSfcStatus, XviFcSfcStatusSchema } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import { RequestExemptionController } from './request-exemption.controller';
import { RequestExemptionService } from './request-exemption.service';
import { RequestExemptionFormJsonConfigService } from './services/form-json/request-exemption-form-json.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcEligibilityExemption.name, schema: XviFcEligibilityExemptionSchema },
      { name: XviFcEligibilityExemptionFormLog.name, schema: XviFcEligibilityExemptionFormLogSchema },
      { name: XviFcAnnualAccount.name, schema: XviFcAnnualAccountSchema },
      { name: XviFcSfcStatus.name, schema: XviFcSfcStatusSchema },
      { name: State.name, schema: StateSchema },
      { name: Ulb.name, schema: UlbSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
  ],
  controllers: [RequestExemptionController],
  providers: [RequestExemptionService, RequestExemptionFormJsonConfigService],
  exports: [RequestExemptionService],
})
export class RequestExemptionModule {}
