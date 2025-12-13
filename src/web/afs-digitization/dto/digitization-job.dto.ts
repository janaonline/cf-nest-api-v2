// src/digitization/dto/digitization-job.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum DigitizationUploadedBy {
  ULB = 'ULB',
  AFS = 'AFS',
}

export class DigitizationFileDto {
  @ApiProperty({
    description: 'Public or internal URL of the PDF to digitize',
    example:
      'https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/objects/c908edc2-1b41-47e9-9a1e-62bc827d80c1.pdf',
  })
  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @ApiProperty({
    enum: DigitizationUploadedBy,
    description: 'Source of this file (ULB main file or AFS attachment)',
    example: DigitizationUploadedBy.ULB,
  })
  @IsEnum(DigitizationUploadedBy)
  uploadedBy!: DigitizationUploadedBy;

  @ApiPropertyOptional({
    description: 'Original file name for logging / display',
    example: 'ULB_2021-22.pdf',
  })
  @IsOptional()
  @IsString()
  originalFileName?: string;
}

export class DigitizationJobDataDto {
  @ApiProperty({
    description: 'Annual Accounts identifier',
    example: '65a7dd50b0c7e600128b1234',
  })
  @IsString()
  @IsNotEmpty()
  annualAccountsId!: string;

  @ApiProperty({
    description: 'ULB identifier',
    example: '65a7dd50b0c7e600128b1234',
  })
  @IsString()
  @IsNotEmpty()
  ulb!: string;

  @ApiProperty({
    description: 'Financial year for which the document is being digitized',
    example: '65a7dd50b0c7e600128b1234',
  })
  @IsString()
  @IsNotEmpty()
  year!: string;

  @ApiProperty({
    description: 'Audit type (audited / unAudited)',
    example: 'audited',
  })
  @IsString()
  @IsNotEmpty()
  auditType!: string;

  @ApiProperty({
    description: 'Default document type for all files in this job (e.g. bal_sheet, income_exp)',
    example: 'bal_sheet',
  })
  @IsString()
  @IsNotEmpty()
  docType!: string;

  @ApiProperty({
    description: 'List of files (ULB + AFS PDFs) to be digitized for this ULB',
    type: () => DigitizationFileDto,
    isArray: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DigitizationFileDto)
  files!: DigitizationFileDto[];
}

/**
 * Batch wrapper for validation + Swagger.
 * If you want the API to accept a top-level array, see the alternative below.
 */
export class DigitizationJobBatchDto {
  @ApiProperty({
    description: 'Array of digitization jobs to queue',
    type: () => DigitizationJobDataDto,
    isArray: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DigitizationJobDataDto)
  jobs!: DigitizationJobDataDto[];
}
