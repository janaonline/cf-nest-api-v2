import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  XviFcBankAccount,
  XviFcBankAccountSchema,
} from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { S3UploadModule } from 'src/s3-upload/s3-upload.module';
import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from './bank-account.service';

@Module({
  imports: [
    S3UploadModule,
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
