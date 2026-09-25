import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
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
import {
  ElectedUrbanLocalBodiesForm,
  ElectedUrbanLocalBodiesFormSchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesRow,
  ElectedUrbanLocalBodiesRowSchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { RequestExemptionMohuaController } from './request-exemption-mohua.controller';
import { RequestExemptionMohuaService } from './request-exemption-mohua.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcEligibilityExemption.name, schema: XviFcEligibilityExemptionSchema },
      { name: XviFcEligibilityExemptionFormLog.name, schema: XviFcEligibilityExemptionFormLogSchema },
      { name: XviFcAnnualAccount.name, schema: XviFcAnnualAccountSchema },
      { name: XviFcSfcStatus.name, schema: XviFcSfcStatusSchema },
      { name: ElectedUrbanLocalBodiesForm.name, schema: ElectedUrbanLocalBodiesFormSchema },
      { name: ElectedUrbanLocalBodiesRow.name, schema: ElectedUrbanLocalBodiesRowSchema },
    ]),
    FormJsonModule,
  ],
  controllers: [RequestExemptionMohuaController],
  providers: [RequestExemptionMohuaService],
})
export class RequestExemptionMohuaModule {}
