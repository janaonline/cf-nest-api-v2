import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExcelService } from 'src/services/excel/excel.service';
import { S3Service } from 'src/core/s3/s3.service';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
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
import {
  ElectedUrbanLocalBodiesForm,
  ElectedUrbanLocalBodiesFormSchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { DevolutionFormulaController } from './devolution-formula.controller';
import { DevolutionFormulaService } from './services/main/devolution-formula.service';
import { DevolutionFormulaExcelService } from './services/excel/devolution-formula-excel.service';
import { DevolutionFormulaRowService } from './services/row/devolution-formula-row.service';
import { DevolutionFormulaValidator } from './validators/devolution-formula.validator';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DevolutionFormulaForm.name, schema: DevolutionFormulaFormSchema },
      { name: DevolutionFormulaRow.name, schema: DevolutionFormulaRowSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: GrantAllocation.name, schema: GrantAllocationSchema },
      // Needed to check Installment 1 prerequisite (EULB must be acknowledged)
      { name: ElectedUrbanLocalBodiesForm.name, schema: ElectedUrbanLocalBodiesFormSchema },
    ]),
    XviFcCommonModule,
  ],
  controllers: [DevolutionFormulaController],
  providers: [
    DevolutionFormulaService,
    DevolutionFormulaExcelService,
    DevolutionFormulaRowService,
    DevolutionFormulaValidator,
    ExcelService,
    S3Service,
  ],
  exports: [DevolutionFormulaService],
})
export class DevolutionFormulaModule {}
