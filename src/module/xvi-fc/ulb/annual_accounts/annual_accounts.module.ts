import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnnualAccountsService } from './annual_accounts.service';
import { AnnualAccountsController } from './annual_accounts.controller';
import { XviFcAnnualAccount, XviFcAnnualAccountSchema } from '../../../../schemas/xvi-fc/annual-account.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcAnnualAccount.name, schema: XviFcAnnualAccountSchema },
    ]),
  ],
  controllers: [AnnualAccountsController],
  providers: [AnnualAccountsService],
  exports: [AnnualAccountsService],
})
export class AnnualAccountsModule {}
