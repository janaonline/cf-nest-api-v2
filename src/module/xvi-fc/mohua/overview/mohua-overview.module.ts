import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { GrantAllocation, GrantAllocationSchema } from 'src/schemas/xvi-fc/grant-allocation.schema';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormSchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  ElectedUrbanLocalBodiesForm,
  ElectedUrbanLocalBodiesFormSchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  XviFcUnspentStateForm,
  XviFcUnspentStateFormSchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import { XviFcGtc, XviFcGtcSchema } from 'src/schemas/xvi-fc/state/gtc-form.schema';
import { XviFcSfcStatus, XviFcSfcStatusSchema } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import {
  DevolutionFormulaRow,
  DevolutionFormulaRowSchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import {
  ElectedUrbanLocalBodiesRow,
  ElectedUrbanLocalBodiesRowSchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { XviFcAnnualAccount, XviFcAnnualAccountSchema } from 'src/schemas/xvi-fc/annual-account.schema';
import { XviFcDur, XviFcDurSchema } from 'src/schemas/xvi-fc/dur.schema';
import { SlbForm, SlbFormSchema } from 'src/schemas/xvi-fc/ulb/slb-form.schema';
import { XviFcBankAccount, XviFcBankAccountSchema } from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { MohuaOverviewController } from './mohua-overview.controller';
import { MohuaStateConditionsService } from './mohua-state-conditions.service';
import { MohuaStateDetailController } from './mohua-state-detail.controller';
import { MohuaStateDetailService } from './mohua-state-detail.service';
import { MohuaStateUlbsService } from './mohua-state-ulbs.service';
import { MohuaUlbFormsController } from './mohua-ulb-forms.controller';
import { MohuaUlbFormsService } from './mohua-ulb-forms.service';
import { MohuaOverviewService } from './mohua-overview.service';
import { MohuaOverviewUlbProgressService } from './mohua-overview-ulb-progress.service';

/** MoHUA-side cross-state overview — read-only, decoupled from the State-side form modules. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
      { name: GrantAllocation.name, schema: GrantAllocationSchema },
      { name: XviFcSfcStatus.name, schema: XviFcSfcStatusSchema },
      { name: ElectedUrbanLocalBodiesForm.name, schema: ElectedUrbanLocalBodiesFormSchema },
      { name: DevolutionFormulaForm.name, schema: DevolutionFormulaFormSchema },
      { name: XviFcUnspentStateForm.name, schema: XviFcUnspentStateFormSchema },
      { name: XviFcGtc.name, schema: XviFcGtcSchema },
      { name: DevolutionFormulaRow.name, schema: DevolutionFormulaRowSchema },
      { name: ElectedUrbanLocalBodiesRow.name, schema: ElectedUrbanLocalBodiesRowSchema },
      { name: XviFcAnnualAccount.name, schema: XviFcAnnualAccountSchema },
      { name: XviFcDur.name, schema: XviFcDurSchema },
      { name: SlbForm.name, schema: SlbFormSchema },
      { name: XviFcBankAccount.name, schema: XviFcBankAccountSchema },
    ]),
    XviFcCommonModule,
  ],
  controllers: [MohuaOverviewController, MohuaStateDetailController, MohuaUlbFormsController],
  providers: [
    MohuaOverviewService,
    MohuaStateDetailService,
    MohuaStateUlbsService,
    MohuaUlbFormsService,
    MohuaStateConditionsService,
    MohuaOverviewUlbProgressService,
  ],
})
export class MohuaOverviewModule {}
