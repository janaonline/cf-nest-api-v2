import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { FcPeriodDto } from './submit-disclosure.dto';

export class UpdateDisclosureDto {
  @ValidateNested()
  @Type(() => FcPeriodDto)
  @IsOptional()
  fc14?: FcPeriodDto;

  @ValidateNested()
  @Type(() => FcPeriodDto)
  @IsOptional()
  fc15?: FcPeriodDto;
}
