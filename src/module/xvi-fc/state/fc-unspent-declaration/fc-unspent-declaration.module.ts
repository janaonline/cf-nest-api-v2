import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormJsonModule } from 'src/master/form-json/form-json.module';
import { S3Service } from 'src/core/s3/s3.service';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import {
  XviFcUnspentStateForm,
  XviFcUnspentStateFormSchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import {
  XviFcUnspentStateFormHistory,
  XviFcUnspentStateFormHistorySchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-history.schema';
import {
  XviFcUnspentStateFormRow,
  XviFcUnspentStateFormRowSchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import {
  XviFcUnspentStateFormRowHistory,
  XviFcUnspentStateFormRowHistorySchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row-history.schema';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormSchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaRow,
  DevolutionFormulaRowSchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { FcUnspentDeclarationController } from './fc-unspent-declaration.controller';
import { FcUnspentDeclarationService } from './services/main/fc-unspent-declaration.service';
import { FcUnspentDeclarationRowService } from './services/rows/fc-unspent-declaration-row.service';
import { FcUnspentUlbOptionsService } from './services/ulb-options/fc-unspent-ulb-options.service';
import { FcUnspentDeclarationFormJsonService } from './services/form-json/fc-unspent-declaration-form-json.service';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcUnspentStateForm.name, schema: XviFcUnspentStateFormSchema },
      { name: XviFcUnspentStateFormHistory.name, schema: XviFcUnspentStateFormHistorySchema },
      { name: XviFcUnspentStateFormRow.name, schema: XviFcUnspentStateFormRowSchema },
      { name: XviFcUnspentStateFormRowHistory.name, schema: XviFcUnspentStateFormRowHistorySchema },
      // Read-only cross-references — this module never writes to Devolution Formula or Ulb.
      { name: DevolutionFormulaForm.name, schema: DevolutionFormulaFormSchema },
      { name: DevolutionFormulaRow.name, schema: DevolutionFormulaRowSchema },
      { name: Ulb.name, schema: UlbSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
    UlbEligibilityModule,
  ],
  controllers: [FcUnspentDeclarationController],
  providers: [
    FcUnspentDeclarationService,
    FcUnspentDeclarationRowService,
    FcUnspentUlbOptionsService,
    FcUnspentDeclarationFormJsonService,
    S3Service,
  ],
  exports: [FcUnspentDeclarationService],
})
export class FcUnspentDeclarationModule {}
