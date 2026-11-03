import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { SlbForm, SlbFormSchema } from 'src/schemas/xvi-fc/ulb/slb-form.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { Adc, AdcSchema } from 'src/schemas/adc.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';
import { XviFcCommonModule } from '../../common/xvi-fc-common.module';
import { SlbController } from './slb.controller';
import { SlbService } from './slb.service';
import { SlbFormJsonConfigService } from './services/slb-form-json.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SlbForm.name, schema: SlbFormSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: Adc.name, schema: AdcSchema },
      { name: Year.name, schema: YearSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
    UlbEligibilityModule,
  ],
  controllers: [SlbController],
  providers: [SlbService, SlbFormJsonConfigService],
  exports: [SlbService],
})
export class SlbModule {}
