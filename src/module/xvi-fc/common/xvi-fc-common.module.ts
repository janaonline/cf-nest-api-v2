import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DynamicFormValidationService } from './dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from './services/xvifc-form-actors.service';
import { FileUrlNormalizerService } from './services/file-url-normalizer.service';
import { FileInfoNormalizerService } from './services/file-info-normalizer.service';
import { FormQuestionHydratorService } from './services/form-question-hydrator.service';
import { ExpectedUlbSetService } from './services/expected-ulb-set.service';
import { XviFcUlbOptionsService } from './services/xvi-fc-ulb-options.service';
import { XviFcUlbOptionsController } from './xvi-fc-ulb-options.controller';
import { ClaimEligibilityEvaluatorService } from './services/claim-eligibility-evaluator.service';
import { YearAccessService } from './services/year-access.service';
import { ExemptionResolverService } from './services/exemption-resolver.service';
import { StateFormPmuReviewHelper } from './services/state-form-pmu-review.helper';
import { PmuRowReviewHelper } from './services/pmu-row-review.helper';
import { PmuUndoEligibilityService } from './services/pmu-undo-eligibility.service';
import { ClaimLetterUlbLock, ClaimLetterUlbLockSchema } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import { ClaimUndoGuard, ClaimUndoGuardSchema } from 'src/schemas/xvi-fc/state/claim-undo-guard.schema';
import {
  DevolutionFormulaFormHistory,
  DevolutionFormulaFormHistorySchema,
} from 'src/schemas/xvi-fc/state/devolution-formula-form-history.schema';
import {
  ElectedUrbanLocalBodiesFormHistory,
  ElectedUrbanLocalBodiesFormHistorySchema,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form-history.schema';
import {
  XviFcUnspentStateFormHistory,
  XviFcUnspentStateFormHistorySchema,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-history.schema';
import { XviFcGtcHistory, XviFcGtcHistorySchema } from 'src/schemas/xvi-fc/state/gtc-form-history.schema';
import { XviFcSfcStatusHistory, XviFcSfcStatusHistorySchema } from 'src/schemas/xvi-fc/state/sfc-status-history.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';
import { FormJsonConfigModule } from 'src/master/form-json-config/form-json-config.module';
import { RemindersModule } from './reminders/reminders.module';
import {
  XviFcEligibilityExemption,
  XviFcEligibilityExemptionSchema,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: Year.name, schema: YearSchema },
      { name: XviFcEligibilityExemption.name, schema: XviFcEligibilityExemptionSchema },
      { name: ClaimLetterUlbLock.name, schema: ClaimLetterUlbLockSchema },
      // PmuUndoEligibilityService: the claim/undo guard, and each State form's history to tell a PMU
      // decision from a status set before the PMU stage existed.
      { name: ClaimUndoGuard.name, schema: ClaimUndoGuardSchema },
      { name: XviFcSfcStatusHistory.name, schema: XviFcSfcStatusHistorySchema },
      { name: XviFcGtcHistory.name, schema: XviFcGtcHistorySchema },
      { name: DevolutionFormulaFormHistory.name, schema: DevolutionFormulaFormHistorySchema },
      { name: ElectedUrbanLocalBodiesFormHistory.name, schema: ElectedUrbanLocalBodiesFormHistorySchema },
      { name: XviFcUnspentStateFormHistory.name, schema: XviFcUnspentStateFormHistorySchema },
    ]),
    UlbEligibilityModule,
    FormJsonConfigModule,
    RemindersModule,
  ],
  controllers: [XviFcUlbOptionsController],
  providers: [
    DynamicFormValidationService,
    XvifcFormActorsService,
    FileUrlNormalizerService,
    FileInfoNormalizerService,
    FormQuestionHydratorService,
    ExpectedUlbSetService,
    XviFcUlbOptionsService,
    ClaimEligibilityEvaluatorService,
    YearAccessService,
    ExemptionResolverService,
    StateFormPmuReviewHelper,
    PmuRowReviewHelper,
    PmuUndoEligibilityService,
  ],
  exports: [
    DynamicFormValidationService,
    XvifcFormActorsService,
    FileUrlNormalizerService,
    FileInfoNormalizerService,
    FormQuestionHydratorService,
    ExpectedUlbSetService,
    ClaimEligibilityEvaluatorService,
    YearAccessService,
    ExemptionResolverService,
    StateFormPmuReviewHelper,
    PmuRowReviewHelper,
    PmuUndoEligibilityService,
    // Re-exported so every PMU/MoHUA review module can inject FormReturnedNotificationService.
    RemindersModule,
  ],
})
export class XviFcCommonModule {}
