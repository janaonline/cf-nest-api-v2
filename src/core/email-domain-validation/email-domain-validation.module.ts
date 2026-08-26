import { Global, Module } from '@nestjs/common';
import { EmailDomainValidationService } from './email-domain-validation.service';

@Global()
@Module({
  providers: [EmailDomainValidationService],
  exports: [EmailDomainValidationService],
})
export class EmailDomainValidationModule {}
