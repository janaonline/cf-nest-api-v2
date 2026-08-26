import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { XviFcCommonModule } from 'src/module/xvi-fc/common/xvi-fc-common.module';
import { ClaimLetterBatch, ClaimLetterBatchSchema } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb, ClaimLetterBatchUlbSchema } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { ClaimLetterUlbLock, ClaimLetterUlbLockSchema } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import {
  ClaimLetterBatchHistory,
  ClaimLetterBatchHistorySchema,
} from 'src/schemas/xvi-fc/state/claim-letter-batch-history.schema';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormSchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaRow,
  DevolutionFormulaRowSchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { State, StateSchema } from 'src/schemas/state.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { User, UserSchema } from 'src/schemas/user/user.schema';
import {
  XviFcUnspentStateForm,
  XviFcUnspentStateFormSchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import {
  XviFcUnspentStateFormRow,
  XviFcUnspentStateFormRowSchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import { S3Service } from 'src/core/s3/s3.service';
import { ClaimLetterController } from './claim-letter.controller';
import { ClaimLetterService } from './services/main/claim-letter.service';
import { ClaimLetterEligibilityService } from './services/eligibility/claim-letter-eligibility.service';
import { ClaimLetterUlbOptionsService } from './services/ulb-options/claim-letter-ulb-options.service';
import { ClaimLetterUlbRowsService } from './services/ulb-rows/claim-letter-ulb-rows.service';
import { ClaimLetterAssemblyService } from './services/assembly/claim-letter-assembly.service';
import { ClaimLetterHistoryService } from './services/history/claim-letter-history.service';
import { ClaimLetterRecoveryService } from './services/recovery/claim-letter-recovery.service';
import { ClaimLetterDocumentService } from './services/document/claim-letter-document.service';
import { ClaimLetterPdfService } from './services/document/claim-letter-pdf.service';
import { ClaimLetterFormJsonService } from './services/form-json/claim-letter-form-json.service';
import { FormJsonModule } from 'src/master/form-json/form-json.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClaimLetterBatch.name, schema: ClaimLetterBatchSchema },
      { name: ClaimLetterBatchUlb.name, schema: ClaimLetterBatchUlbSchema },
      { name: ClaimLetterUlbLock.name, schema: ClaimLetterUlbLockSchema },
      { name: ClaimLetterBatchHistory.name, schema: ClaimLetterBatchHistorySchema },
      // Read-only cross-references — this module never writes to Devolution Formula, Ulb, State,
      // Year, User, or FC Unspent Declaration.
      { name: DevolutionFormulaForm.name, schema: DevolutionFormulaFormSchema },
      { name: DevolutionFormulaRow.name, schema: DevolutionFormulaRowSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: State.name, schema: StateSchema },
      { name: Year.name, schema: YearSchema },
      { name: User.name, schema: UserSchema },
      { name: XviFcUnspentStateForm.name, schema: XviFcUnspentStateFormSchema },
      { name: XviFcUnspentStateFormRow.name, schema: XviFcUnspentStateFormRowSchema },
    ]),
    XviFcCommonModule,
    FormJsonModule,
  ],
  controllers: [ClaimLetterController],
  providers: [
    ClaimLetterService,
    ClaimLetterEligibilityService,
    ClaimLetterUlbOptionsService,
    ClaimLetterUlbRowsService,
    ClaimLetterAssemblyService,
    ClaimLetterHistoryService,
    ClaimLetterRecoveryService,
    ClaimLetterDocumentService,
    ClaimLetterPdfService,
    ClaimLetterFormJsonService,
    S3Service,
  ],
  exports: [ClaimLetterService],
})
export class ClaimLetterModule {}
