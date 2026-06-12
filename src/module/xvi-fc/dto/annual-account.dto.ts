import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { AnnualAccountStatus } from '../../../schemas/xvi-fc/annual-account.schema';

export class AnnualAccountDocumentDto {
  @IsString()
  @IsNotEmpty()
  docId: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsOptional()
  fileName?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  fileSize?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  pages?: number;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @IsString()
  @IsNotEmpty()
  filePath: string;

  @IsString()
  @IsOptional()
  fileUrl?: string;
}

export class YearSectionDto {
  @IsMongoId()
  yearId: string;

  @IsString()
  @IsNotEmpty()
  year: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnnualAccountDocumentDto)
  documents: AnnualAccountDocumentDto[];
}

export class SaveAnnualAccountDto {
  @IsMongoId()
  ulb: string;

  @IsMongoId()
  design_year: string;

  @ValidateNested()
  @Type(() => YearSectionDto)
  @IsOptional()
  auditedData?: YearSectionDto;

  @ValidateNested()
  @Type(() => YearSectionDto)
  @IsOptional()
  unauditedData?: YearSectionDto;

  @IsEnum(AnnualAccountStatus)
  @IsOptional()
  status?: AnnualAccountStatus;

  @IsBoolean()
  @IsOptional()
  isDraft?: boolean;
}
