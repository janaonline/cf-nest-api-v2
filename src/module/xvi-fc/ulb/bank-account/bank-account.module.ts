import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  XviFcBankAccount,
  XviFcBankAccountSchema,
} from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from './bank-account.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: XviFcBankAccount.name,
        schema: XviFcBankAccountSchema,
      },
      { name: Ulb.name, schema: UlbSchema },
    ]),
  ],
  controllers: [BankAccountController],
  providers: [BankAccountService],
  exports: [BankAccountService],
})
export class BankAccountModule {}
