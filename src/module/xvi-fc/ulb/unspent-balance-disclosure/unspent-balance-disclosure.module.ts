import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { S3Module } from '../../../../core/s3/s3.module';
import { S3Service } from '../../../../core/s3/s3.service';
import {
  XviFcUnspentBalanceDisclosure,
  XviFcUnspentBalanceDisclosureSchema,
} from '../../../../schemas/xvi-fc/unspent-balance-disclosure.schema';
import { UnspentBalanceDisclosureController } from './unspent-balance-disclosure.controller';
import { UnspentBalanceDisclosureService } from './unspent-balance-disclosure.service';

@Module({
  imports: [
    S3Module,
    MongooseModule.forFeature([
      {
        name: XviFcUnspentBalanceDisclosure.name,
        schema: XviFcUnspentBalanceDisclosureSchema,
      },
    ]),
  ],
  controllers: [UnspentBalanceDisclosureController],
  providers: [UnspentBalanceDisclosureService, S3Service],
})
export class UnspentBalanceDisclosureModule {}
