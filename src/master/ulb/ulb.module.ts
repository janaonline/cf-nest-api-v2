import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailQueueModule } from 'src/core/queue/email-queue/email-queue.module';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { FormJsonConfigModule } from 'src/master/form-json-config/form-json-config.module';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { User, UserSchema } from 'src/schemas/user/user.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { SlbForm, SlbFormSchema } from 'src/schemas/xvi-fc/ulb/slb-form.schema';
import { UlbController } from './ulb.controller';
import { UlbService } from './ulb.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: State.name, schema: StateSchema },
      { name: User.name, schema: UserSchema },
      { name: Year.name, schema: YearSchema },
      { name: SlbForm.name, schema: SlbFormSchema },
    ]),
    FormJsonModule,
    FormJsonConfigModule,
    XviFcCommonModule,
    EmailQueueModule,
  ],
  controllers: [UlbController],
  providers: [UlbService],
  exports: [UlbService],
})
export class UlbModule {}
