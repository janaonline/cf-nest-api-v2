import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AfsExcelFile, AfsExcelFileSchema } from 'src/schemas/afs/afs-excel-file.schema';
import { AnnualAccountData, AnnualAccountDataSchema } from 'src/schemas/annual-account-data.schema';
import { DigitizationLog, DigitizationLogSchema } from 'src/schemas/digitization-log.schema';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { AfsDigitizationController } from './afs-digitization.controller';
import { AfsDigitizationService } from './afs-digitization.service';
import { AfsDumpService } from './afs-dump.service';
import { BullModule } from '@nestjs/bullmq';
import { DigitizationQueueService } from './queue/digitization-queue/digitization-queue.service';
import { DigitizationProcessor } from './queue/digitization.processor';
import { HttpModule } from '@nestjs/axios';
import { S3Module } from 'src/core/s3/s3.module';
import { S3Service } from 'src/core/s3/s3.service';

@Module({
  imports: [
    HttpModule,
    S3Module,
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
      { name: AfsExcelFile.name, schema: AfsExcelFileSchema },
      { name: AnnualAccountData.name, schema: AnnualAccountDataSchema },
    ]),
    MongooseModule.forFeature([{ name: DigitizationLog.name, schema: DigitizationLogSchema }], 'digitization_db'),
    BullModule.registerQueue({
      name: 'afsDigitization',
    }),
  ],
  controllers: [AfsDigitizationController],
  providers: [AfsDigitizationService, AfsDumpService, DigitizationQueueService, DigitizationProcessor, S3Service],
})
export class AfsDigitizationModule {}
