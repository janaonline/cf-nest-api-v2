import { Module } from '@nestjs/common';
import { DynamicFormValidationService } from './dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from './services/xvifc-form-actors.service';

@Module({
  providers: [DynamicFormValidationService, XvifcFormActorsService],
  exports: [DynamicFormValidationService, XvifcFormActorsService],
})
export class XviFcCommonModule {}
