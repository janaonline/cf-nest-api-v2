import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AfsExcelFile, AfsExcelFileSchema } from 'src/schemas/afs-excel-file.schema';
import { AnnualAccountData, AnnualAccountDataSchema } from 'src/schemas/annual-account-data.schema';
import { DigitizationLog, DigitizationLogSchema } from 'src/schemas/digitization-log.schema';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { AfsDigitizationController } from './afs-digitization.controller';
import { AfsDigitizationService } from './afs-digitization.service';
import { AfsDumpService } from './afs-dump.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
      { name: AfsExcelFile.name, schema: AfsExcelFileSchema },
      { name: AnnualAccountData.name, schema: AnnualAccountDataSchema },
    ]),
    MongooseModule.forFeature([{ name: DigitizationLog.name, schema: DigitizationLogSchema }], 'digitization_db'),
  ],
  controllers: [AfsDigitizationController],
  providers: [AfsDigitizationService, AfsDumpService],
})
export class AfsDigitizationModule {}
