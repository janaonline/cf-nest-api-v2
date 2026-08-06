import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DynamicFormValidationService } from './dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from './services/xvifc-form-actors.service';
import { FileUrlNormalizerService } from './services/file-url-normalizer.service';
import { FileInfoNormalizerService } from './services/file-info-normalizer.service';
import { ExpectedUlbSetService } from './services/expected-ulb-set.service';
import { ClaimEligibilityEvaluatorService } from './services/claim-eligibility-evaluator.service';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { Year, YearSchema } from 'src/schemas/year.schema';
import { UlbEligibilityModule } from 'src/module/ulb-eligibility/ulb-eligibility.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ulb.name, schema: UlbSchema },
      { name: Year.name, schema: YearSchema },
    ]),
    UlbEligibilityModule,
  ],
  providers: [
    DynamicFormValidationService,
    XvifcFormActorsService,
    FileUrlNormalizerService,
    FileInfoNormalizerService,
    ExpectedUlbSetService,
    ClaimEligibilityEvaluatorService,
  ],
  exports: [
    DynamicFormValidationService,
    XvifcFormActorsService,
    FileUrlNormalizerService,
    FileInfoNormalizerService,
    ExpectedUlbSetService,
    ClaimEligibilityEvaluatorService,
  ],
})
export class XviFcCommonModule {}
