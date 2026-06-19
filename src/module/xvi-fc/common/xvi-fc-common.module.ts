import { Module } from '@nestjs/common';
import { DynamicFormValidationService } from './dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from './services/xvifc-form-actors.service';
import { FileUrlNormalizerService } from './services/file-url-normalizer.service';

@Module({
  providers: [DynamicFormValidationService, XvifcFormActorsService, FileUrlNormalizerService],
  exports: [DynamicFormValidationService, XvifcFormActorsService, FileUrlNormalizerService],
})
export class XviFcCommonModule {}
