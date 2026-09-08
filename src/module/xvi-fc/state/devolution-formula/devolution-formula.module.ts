import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExcelService } from 'src/services/excel/excel.service';
import { S3Service } from 'src/core/s3/s3.service';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { XviFcModule } from 'src/module/xvi-fc/xvi-fc.module';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { DfFormJsonConfigService } from './services/form-json/devolution-formula-form-json.service';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormSchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaRow,
  DevolutionFormulaRowSchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { GrantAllocation, GrantAllocationSchema } from 'src/schemas/xvi-fc/grant-allocation.schema';
import { DevolutionFormulaController } from './devolution-formula.controller';
import { DevolutionFormulaService } from './services/main/devolution-formula.service';
import { DevolutionFormulaExcelService } from './services/excel/devolution-formula-excel.service';
import { DevolutionFormulaRowService } from './services/row/devolution-formula-row.service';
import { DevolutionFormulaValidator } from './validators/devolution-formula.validator';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DevolutionFormulaForm.name, schema: DevolutionFormulaFormSchema },
      { name: DevolutionFormulaRow.name, schema: DevolutionFormulaRowSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: GrantAllocation.name, schema: GrantAllocationSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
    UlbEligibilityModule,
    // Needed for XviFcService.getStateById/getYearLabelById (download filename resolution in the
    // controller) — forwardRef because XviFcModule imports this module back.
    forwardRef(() => XviFcModule),
  ],
  controllers: [DevolutionFormulaController],
  providers: [
    DevolutionFormulaService,
    DevolutionFormulaExcelService,
    DevolutionFormulaRowService,
    DevolutionFormulaValidator,
    DfFormJsonConfigService,
    ExcelService,
    S3Service,
  ],
  exports: [DevolutionFormulaService],
})
export class DevolutionFormulaModule {}
