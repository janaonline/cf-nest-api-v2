import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { XviFcController } from './xvi-fc.controller';
import { XviFcService } from './xvi-fc.service';
import {
  GrantAllocation,
  GrantAllocationSchema,
} from './schemas/grant-allocation.schema';
import { State, StateSchema } from './schemas/state.schema';
import { Year, YearSchema } from './schemas/year.schema';
import { Ulb, UlbSchema } from './schemas/ulb.schema';

@Module({
   imports: [
    MongooseModule.forFeature([
      { name: GrantAllocation.name, schema: GrantAllocationSchema },
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
      { name: Ulb.name, schema: UlbSchema },
    ]),
  ],
  controllers: [XviFcController],
  providers: [XviFcService],
})
export class XviFcModule {}
