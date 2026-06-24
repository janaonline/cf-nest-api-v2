import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExcelService } from 'src/services/excel/excel.service';
import { S3Service } from 'src/core/s3/s3.service';
import { XviFcCommonModule } from '../../common/xvi-fc-common.module';
import { FormJsonModule } from 'src/form-json/form-json.module';
import { EulbFormJsonConfigService } from './elected-urban-local-bodies-form-json.service';
import {
  ElectedUrbanLocalBodiesForm,
  ElectedUrbanLocalBodiesFormSchema,
} from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesRow,
  ElectedUrbanLocalBodiesRowSchema,
} from '../../../../schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Ulb, UlbSchema } from '../../../../schemas/ulb.schema';
import { ElectedUrbanLocalBodiesController } from './elected-urban-local-bodies.controller';
import { ElectedUrbanLocalBodiesService } from './elected-urban-local-bodies.service';
import { ElectedUrbanLocalBodiesExcelService } from './elected-urban-local-bodies-excel.service';
import { ElectedUrbanLocalBodiesRowService } from './elected-urban-local-bodies-row.service';
import { ElectedUrbanLocalBodiesValidator } from './elected-urban-local-bodies.validator';
import { EulbPostSubmissionUpdateService } from './elected-urban-local-bodies-post-submission-update.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ElectedUrbanLocalBodiesForm.name, schema: ElectedUrbanLocalBodiesFormSchema },
      { name: ElectedUrbanLocalBodiesRow.name, schema: ElectedUrbanLocalBodiesRowSchema },
      { name: Ulb.name, schema: UlbSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
  ],
  controllers: [ElectedUrbanLocalBodiesController],
  providers: [
    ElectedUrbanLocalBodiesService,
    ElectedUrbanLocalBodiesExcelService,
    ElectedUrbanLocalBodiesRowService,
    ElectedUrbanLocalBodiesValidator,
    EulbPostSubmissionUpdateService,
    EulbFormJsonConfigService,
    ExcelService,
    S3Service,
  ],
  exports: [ElectedUrbanLocalBodiesService],
})
export class ElectedUrbanLocalBodiesModule {}
