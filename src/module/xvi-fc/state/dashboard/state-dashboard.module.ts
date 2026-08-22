import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { State, StateSchema } from '../../../../schemas/state.schema';
import { Ulb, UlbSchema } from '../../../../schemas/ulb.schema';
import { Year, YearSchema } from '../../../../schemas/year.schema';
import { XviFcAnnualAccount, XviFcAnnualAccountSchema } from '../../../../schemas/xvi-fc/annual-account.schema';
import { GrantAllocation, GrantAllocationSchema } from '../../../../schemas/xvi-fc/grant-allocation.schema';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormSchema,
} from '../../../../schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  ElectedUrbanLocalBodiesForm,
  ElectedUrbanLocalBodiesFormSchema,
} from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { XviFcSfcStatus, XviFcSfcStatusSchema } from '../../../../schemas/xvi-fc/state/sfc-status.schema';
import {
  XviFcUnspentBalanceDisclosure,
  XviFcUnspentBalanceDisclosureSchema,
} from '../../../../schemas/xvi-fc/unspent-balance-disclosure.schema';
import { XviFcBankAccount, XviFcBankAccountSchema } from '../../../../schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { StateDashboardController } from './state-dashboard.controller';
import { StateDashboardService } from './state-dashboard.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: GrantAllocation.name, schema: GrantAllocationSchema },
      { name: DevolutionFormulaForm.name, schema: DevolutionFormulaFormSchema },
      { name: XviFcSfcStatus.name, schema: XviFcSfcStatusSchema },
      { name: ElectedUrbanLocalBodiesForm.name, schema: ElectedUrbanLocalBodiesFormSchema },
      { name: XviFcAnnualAccount.name, schema: XviFcAnnualAccountSchema },
      { name: XviFcBankAccount.name, schema: XviFcBankAccountSchema },
      { name: XviFcUnspentBalanceDisclosure.name, schema: XviFcUnspentBalanceDisclosureSchema },
    ]),
  ],
  controllers: [StateDashboardController],
  providers: [StateDashboardService],
  exports: [StateDashboardService],
})
export class StateDashboardModule {}
