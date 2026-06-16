import { Module } from '@nestjs/common';
import { DynamicFormValidationService } from './dynamic-form-validation/dynamic-form-validation.service';

@Module({
  providers: [DynamicFormValidationService],
  exports: [DynamicFormValidationService],
})
export class XviFcCommonModule {}
