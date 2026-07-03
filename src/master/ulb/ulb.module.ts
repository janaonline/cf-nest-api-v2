import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJsonModule } from 'src/form-json/form-json.module';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { UlbController } from './ulb.controller';
import { UlbService } from './ulb.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: State.name, schema: StateSchema },
    ]),
    FormJsonModule,
    XviFcCommonModule,
  ],
  controllers: [UlbController],
  providers: [UlbService],
  exports: [UlbService],
})
export class UlbModule {}
