import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { AfsDigitizationController } from './afs-digitization.controller';
import { AfsDigitizationService } from './afs-digitization.service';
import { AfsGeneratedExcel, AfsGeneratedExcelSchema } from './entities/afs-generated-excel.schema';
import { AfsMetric, AfsMetricSchema } from './entities/afs-metrics.schema';
import { AfsReuploadedPdf, AfsReuploadedPdfSchema } from './entities/afs-reuploaded-pdf.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
    ]),
    MongooseModule.forFeature(
      [
        { name: AfsGeneratedExcel.name, schema: AfsGeneratedExcelSchema },
        { name: AfsReuploadedPdf.name, schema: AfsReuploadedPdfSchema },
        { name: AfsMetric.name, schema: AfsMetricSchema },
      ],
      'CONNECTION_2',
    ),
  ],
  controllers: [AfsDigitizationController],
  providers: [AfsDigitizationService],
})
export class AfsDigitizationModule {}
