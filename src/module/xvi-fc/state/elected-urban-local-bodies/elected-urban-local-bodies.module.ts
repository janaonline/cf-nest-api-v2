import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExcelService } from 'src/services/excel/excel.service';
import { S3Service } from 'src/core/s3/s3.service';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import {
  ElectedUrbanLocalBodiesForm,
  ElectedUrbanLocalBodiesFormSchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesRow,
  ElectedUrbanLocalBodiesRowSchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { ElectedUrbanLocalBodiesController } from 'src/module/xvi-fc/state/elected-urban-local-bodies/controllers/elected-urban-local-bodies.controller';
import { ElectedUrbanLocalBodiesService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/main/elected-urban-local-bodies.service';
import { ElectedUrbanLocalBodiesExcelService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/excel/elected-urban-local-bodies-excel.service';
import { ElectedUrbanLocalBodiesRowService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/row/elected-urban-local-bodies-row.service';
import { ElectedUrbanLocalBodiesValidator } from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import { EulbPostSubmissionUpdateService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/post-submission-update/elected-urban-local-bodies-post-submission-update.service';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ElectedUrbanLocalBodiesForm.name, schema: ElectedUrbanLocalBodiesFormSchema },
      { name: ElectedUrbanLocalBodiesRow.name, schema: ElectedUrbanLocalBodiesRowSchema },
      { name: Ulb.name, schema: UlbSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
    UlbEligibilityModule,
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
