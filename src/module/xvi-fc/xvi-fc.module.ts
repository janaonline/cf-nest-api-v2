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
import { XviFcSideMenu, XviFcSideMenuSchema } from '../../schemas/xvi-fc/xvi-fc-side-menu.schema';
import { XviFcCacheService } from './cache/xvi-fc-cache.service';
import { XviFcCacheInterceptor } from './cache/xvi-fc-cache.interceptor';
import { SideMenuModule } from './side-menu/side-menu.module';
import { FormJsonModule } from '../../form-json/form-json.module';
import { UnspentBalanceDisclosureModule } from './ulb/unspent-balance-disclosure/unspent-balance-disclosure.module';
import { XviFcAnnualAccount, XviFcAnnualAccountSchema } from '../../schemas/xvi-fc/annual-account.schema';
import {
  XviFcUnspentBalanceDisclosure,
  XviFcUnspentBalanceDisclosureSchema,
} from '../../schemas/xvi-fc/unspent-balance-disclosure.schema';
import { DevolutionFormulaModule } from './state/devolution-formula/devolution-formula.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GrantAllocation.name, schema: GrantAllocationSchema },
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: XviFcSideMenu.name, schema: XviFcSideMenuSchema },
      { name: XviFcAnnualAccount.name, schema: XviFcAnnualAccountSchema },
      { name: XviFcUnspentBalanceDisclosure.name, schema: XviFcUnspentBalanceDisclosureSchema },
    ]),
    AnnualAccountsModule,
    SfcStatusModule,
    ElectedUrbanLocalBodiesModule,
    SideMenuModule,
    FormJsonModule,
    UnspentBalanceDisclosureModule,
    DevolutionFormulaModule,
  ],
  controllers: [XviFcController],
  providers: [XviFcService, XviFcCacheService, XviFcCacheInterceptor],
  exports: [XviFcCacheService, XviFcCacheInterceptor],
})
export class XviFcModule {}
