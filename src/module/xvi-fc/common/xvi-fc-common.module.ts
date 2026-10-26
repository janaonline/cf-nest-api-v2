import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DynamicFormValidationService } from './dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from './services/xvifc-form-actors.service';
import { FileUrlNormalizerService } from './services/file-url-normalizer.service';
import { FileInfoNormalizerService } from './services/file-info-normalizer.service';
import { FormQuestionHydratorService } from './services/form-question-hydrator.service';
import { ExpectedUlbSetService } from './services/expected-ulb-set.service';
import { ClaimEligibilityEvaluatorService } from './services/claim-eligibility-evaluator.service';
import { YearAccessService } from './services/year-access.service';
import { ExemptionResolverService } from './services/exemption-resolver.service';
import { StateFormPmuReviewHelper } from './services/state-form-pmu-review.helper';
import { PmuRowReviewHelper } from './services/pmu-row-review.helper';
import { PmuUndoEligibilityService } from './services/pmu-undo-eligibility.service';
import { ClaimLetterUlbLock, ClaimLetterUlbLockSchema } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
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
    ]),
    UlbEligibilityModule,
    FormJsonConfigModule,
    RemindersModule,
  ],
  providers: [
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
