import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { XviFcAnnualAccount, XviFcAnnualAccountSchema } from 'src/schemas/xvi-fc/annual-account.schema';
import { XviFcDur, XviFcDurSchema } from 'src/schemas/xvi-fc/dur.schema';
import { XviFcBankAccount, XviFcBankAccountSchema } from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { MohuaOverviewModule } from 'src/module/xvi-fc/mohua/overview/mohua-overview.module';
import { StateNotificationsController } from './state-notifications.controller';
import { StateNotificationsService } from './state-notifications.service';

/** State bell + sidebar dots feed — read-only, reuses MoHUA overview's five-form status lookup. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcAnnualAccount.name, schema: XviFcAnnualAccountSchema },
      { name: XviFcBankAccount.name, schema: XviFcBankAccountSchema },
      { name: XviFcDur.name, schema: XviFcDurSchema },
    ]),
    MohuaOverviewModule,
  ],
  controllers: [StateNotificationsController],
  providers: [StateNotificationsService],
})
export class StateNotificationsModule {}
