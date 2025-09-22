import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose/dist/mongoose.module';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { AnnualAccountsController } from './annualaccounts.controller';
import { AnnualAccountsService } from './annualaccounts.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      // { name: AnnualAccountData.name, schema: AnnualAccountDataSchema },
      { name: Ulb.name, schema: UlbSchema },
    ]),
  ],
  controllers: [AnnualAccountsController],
  providers: [AnnualAccountsService],
})
export class AnnualAccountsModule {}
