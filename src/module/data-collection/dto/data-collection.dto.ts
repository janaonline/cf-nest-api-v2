import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { DEFAULT_TEMPLATE_VERSION } from 'src/module/line-items-legends/types';

export class DataCollectionDto {
  @ApiProperty({ description: 'Public ULB code (censusCode or sbCode)' })
  @IsString()
  @IsNotEmpty()
  ulbCode!: string;

  @ApiProperty({ description: 'Financial year code (e.g., 2021-22)' })
  @IsString()
  @IsNotEmpty()
  yearCode!: string;

  @ApiPropertyOptional({
    example: DEFAULT_TEMPLATE_VERSION,
    description: 'Template version. Defaults to the current active version.',
  })
  @IsString()
  @IsOptional()
  templateVersion?: string;

  @ApiProperty({
    description: 'Line items keyed by nmamCode with numeric values.',
  })
  @IsObject()
  @IsNotEmpty()
  lineItems!: Record<string, unknown>;
}
