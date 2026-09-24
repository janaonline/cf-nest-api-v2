import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import type { SubmissionScope } from 'src/schemas/form-json-config.schema';

export class CreateFormJsonConfigDto {
  @ApiProperty({ description: 'Numeric form id (matches the module SLB_FORM_ID-style constant); unique' })
  @IsNumber()
  formId!: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isApplicableForExemption?: boolean;

  @ApiPropertyOptional({ default: 1, description: 'How many of the ULB own participating years stay exempted' })
  @IsOptional()
  @IsInt()
  @Min(1)
  exemptionGraceYears?: number;

  @ApiPropertyOptional({ default: 'PER_YEAR', enum: ['PER_YEAR', 'ONCE_EVER'] })
  @IsOptional()
  @IsIn(['PER_YEAR', 'ONCE_EVER'])
  submissionScope?: SubmissionScope;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
