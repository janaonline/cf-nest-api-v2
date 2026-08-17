import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  XviFcBankAccount,
  XviFcBankAccountSchema,
} from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import {
  XviFcBankAccountFormLog,
  XviFcBankAccountFormLogSchema,
} from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account-form-log.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { S3Module } from 'src/core/s3/s3.module';
import { S3Service } from 'src/core/s3/s3.service';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from './bank-account.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: XviFcBankAccount.name,
        schema: XviFcBankAccountSchema,
      },
      {
        name: XviFcBankAccountFormLog.name,
        schema: XviFcBankAccountFormLogSchema,
      },
      { name: Ulb.name, schema: UlbSchema },
    ]),
    S3Module,
    UlbEligibilityModule,
    FormJsonModule,
  ],
  controllers: [BankAccountController],
  providers: [BankAccountService, S3Service],
  exports: [BankAccountService],
})
export class BankAccountModule {}
