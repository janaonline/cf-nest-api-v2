import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExcelService } from 'src/services/excel/excel.service';
import { S3Service } from 'src/core/s3/s3.service';
import { XviFcModule } from 'src/module/xvi-fc/xvi-fc.module';
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
import { Year, YearSchema } from 'src/schemas/year.schema';
import { ElectedUrbanLocalBodiesController } from 'src/module/xvi-fc/state/elected-urban-local-bodies/controllers/elected-urban-local-bodies.controller';
import { ElectedUrbanLocalBodiesService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/main/elected-urban-local-bodies.service';
import { ElectedUrbanLocalBodiesExcelService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/excel/elected-urban-local-bodies-excel.service';
import { ElectedUrbanLocalBodiesRowService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/row/elected-urban-local-bodies-row.service';
import { ElectedUrbanLocalBodiesValidator } from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import { EulbPostSubmissionUpdateService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/post-submission-update/elected-urban-local-bodies-post-submission-update.service';
import { ElectedUrbanLocalBodiesDocumentService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/document/elected-urban-local-bodies-document.service';
import { ElectedUrbanLocalBodiesDocxService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/document/elected-urban-local-bodies-docx.service';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ElectedUrbanLocalBodiesForm.name, schema: ElectedUrbanLocalBodiesFormSchema },
      { name: ElectedUrbanLocalBodiesRow.name, schema: ElectedUrbanLocalBodiesRowSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: Year.name, schema: YearSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
    UlbEligibilityModule,
    // Needed for XviFcService.getStateById/getYearLabelById (download filename resolution in the
    // controller) — forwardRef because XviFcModule imports this module back.
    forwardRef(() => XviFcModule),
  ],
  controllers: [ElectedUrbanLocalBodiesController],
  providers: [
    ElectedUrbanLocalBodiesService,
    ElectedUrbanLocalBodiesExcelService,
    ElectedUrbanLocalBodiesRowService,
    ElectedUrbanLocalBodiesValidator,
    EulbPostSubmissionUpdateService,
    ElectedUrbanLocalBodiesDocumentService,
    ElectedUrbanLocalBodiesDocxService,
    EulbFormJsonConfigService,
    ExcelService,
    S3Service,
  ],
  exports: [ElectedUrbanLocalBodiesService],
})
export class ElectedUrbanLocalBodiesModule {}
