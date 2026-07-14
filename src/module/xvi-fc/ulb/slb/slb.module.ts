import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJsonModule } from 'src/form-json/form-json.module';
import { SlbForm, SlbFormSchema } from 'src/schemas/xvi-fc/ulb/slb-form.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { XviFcCommonModule } from '../../common/xvi-fc-common.module';
import { SlbController } from './slb.controller';
import { SlbService } from './slb.service';
import { SlbFormJsonConfigService } from './services/slb-form-json.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SlbForm.name, schema: SlbFormSchema },
      { name: Ulb.name, schema: UlbSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
  ],
  controllers: [SlbController],
  providers: [SlbService, SlbFormJsonConfigService],
  exports: [SlbService],
})
export class SlbModule {}
