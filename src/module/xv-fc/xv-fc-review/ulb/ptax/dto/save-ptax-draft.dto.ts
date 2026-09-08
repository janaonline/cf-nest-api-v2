import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { PTAX_METRIC_CODES } from '../../../common/ptax.constants';

class DraftMetricDto {
  @ApiProperty({ example: '1.9', description: 'Metric code — one of 1.9, 1.10, 1.17, 1.18, 2.3, 2.4' })
  @IsString()
  @IsNotEmpty()
  @IsIn(PTAX_METRIC_CODES)
  code: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  flagged: boolean;

  @ApiProperty({ required: false, example: 888888, description: 'The ULB-claimed correct value for this metric' })
  @IsOptional()
  @IsNumber()
  proposedValue?: number;

  @ApiProperty({ required: false, example: 'Verified against our records, figure was underreported' })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class SavePtaxDraftDto {
  @ApiProperty({ type: [DraftMetricDto], description: 'Only send the metrics being changed in this call' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftMetricDto)
  metrics: DraftMetricDto[];
}
