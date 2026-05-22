import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { DEFAULT_TEMPLATE_VERSION } from 'src/module/line-items-legends/types';

export class DataCollectionDto {
  @ApiProperty({ description: 'ULB Id' })
  @IsMongoId()
  @IsNotEmpty()
  ulbId!: string;

  @ApiProperty({ description: 'Year Id' })
  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

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
