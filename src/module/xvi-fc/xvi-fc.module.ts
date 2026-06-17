import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { XviFcController } from './xvi-fc.controller';
import { XviFcService } from './xvi-fc.service';
import { AnnualAccountsModule } from './ulb/annual_accounts/annual_accounts.module';
import { SfcStatusModule } from './state/sfc-status/sfc-status.module';
import { ElectedUrbanLocalBodiesModule } from './state/elected-urban-local-bodies/elected-urban-local-bodies.module';
import { GrantAllocation, GrantAllocationSchema } from '../../schemas/xvi-fc/grant-allocation.schema';
import { State, StateSchema } from '../../schemas/state.schema';
import { Year, YearSchema } from '../../schemas/year.schema';
import { Ulb, UlbSchema } from '../../schemas/ulb.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GrantAllocation.name, schema: GrantAllocationSchema },
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
      { name: Ulb.name, schema: UlbSchema },
    ]),
    AnnualAccountsModule,
    SfcStatusModule,
    ElectedUrbanLocalBodiesModule,
  ],
  controllers: [XviFcController],
  providers: [XviFcService],
})
export class XviFcModule {}
