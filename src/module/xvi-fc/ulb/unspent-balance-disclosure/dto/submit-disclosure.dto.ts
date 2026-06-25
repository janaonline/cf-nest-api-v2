import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class DisclosureDocDto {
  @IsString()
  @IsNotEmpty()
  filepath: string;

  @IsString()
  @IsNotEmpty()
  originalName: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sizeKb?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  pages?: number;
}

export class FcPeriodDto {
  @IsNumber()
  unspentBalance: number;

  @IsString()
  @Matches(/^\d{9,18}$/, { message: 'Bank account number must contain 9–18 digits only.' })
  bankAccountNumber: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one supporting document is required.' })
  @ValidateNested({ each: true })
  @Type(() => DisclosureDocDto)
  documents: DisclosureDocDto[];
}

export class SubmitDisclosureDto {
  @IsMongoId()
  designYearId: string;

  @IsString()
  @IsIn(['manual', 'document-assisted'])
  mode: string;

  @ValidateNested()
  @Type(() => FcPeriodDto)
  fc14: FcPeriodDto;

  @ValidateNested()
  @Type(() => FcPeriodDto)
  fc15: FcPeriodDto;
}
