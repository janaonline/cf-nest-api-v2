import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { DisclosureDocDto } from './submit-disclosure.dto';

export class UpdateFcPeriodDto {
  @IsNumber()
  @IsOptional()
  unspentBalance?: number;

  @IsString()
  @IsOptional()
  @Matches(/^\d{9,18}$/, { message: 'Bank account number must contain 9–18 digits only.' })
  bankAccountNumber?: string;

  @IsArray()
  @IsOptional()
  @ArrayMinSize(1, { message: 'At least one supporting document is required.' })
  @ValidateNested({ each: true })
  @Type(() => DisclosureDocDto)
  documents?: DisclosureDocDto[];
}

export class UpdateDisclosureDto {
  @IsString()
  @IsIn(['manual', 'document-assisted'])
  @IsOptional()
  mode?: string;

  @ValidateNested()
  @Type(() => UpdateFcPeriodDto)
  @IsOptional()
  fc14?: UpdateFcPeriodDto;

  @ValidateNested()
  @Type(() => UpdateFcPeriodDto)
  @IsOptional()
  fc15?: UpdateFcPeriodDto;

  @IsString()
  @IsIn(['DRAFT', 'SUBMITTED'])
  @IsOptional()
  formStatus?: string;
}
