import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  XviFcEligibilityExemption,
  XviFcEligibilityExemptionSchema,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import {
  XviFcEligibilityExemptionFormLog,
  XviFcEligibilityExemptionFormLogSchema,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption-form-log.schema';
import { XviFcAnnualAccount, XviFcAnnualAccountSchema } from 'src/schemas/xvi-fc/annual-account.schema';
import { RequestExemptionMohuaController } from './request-exemption-mohua.controller';
import { RequestExemptionMohuaService } from './request-exemption-mohua.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcEligibilityExemption.name, schema: XviFcEligibilityExemptionSchema },
      { name: XviFcEligibilityExemptionFormLog.name, schema: XviFcEligibilityExemptionFormLogSchema },
      { name: XviFcAnnualAccount.name, schema: XviFcAnnualAccountSchema },
    ]),
  ],
  controllers: [RequestExemptionMohuaController],
  providers: [RequestExemptionMohuaService],
})
export class RequestExemptionMohuaModule {}
