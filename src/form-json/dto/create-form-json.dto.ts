import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsMongoId, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';

export class CreateFormJsonDto {
  @ApiProperty({ description: 'Year ObjectId this form template belongs to' })
  @IsMongoId()
  design_year!: string;

  @ApiPropertyOptional({ description: 'Numeric form id; unique per design_year' })
  @IsOptional()
  @IsNumber()
  formId?: number;

  @ApiPropertyOptional({ description: 'String key used to look up this form (e.g. "xvifcSfc")' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Field config array defining form fields and validations' })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  data?: FieldConfig[];

  @ApiPropertyOptional({ description: 'Arbitrary form-level metadata' })
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
