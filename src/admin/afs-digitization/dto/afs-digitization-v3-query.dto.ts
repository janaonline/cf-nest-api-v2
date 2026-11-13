import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsOptional } from 'class-validator';
import { DigitizationV3Statuses } from 'src/schemas/afs/enums';
import { DigitizationReportQueryDto } from './digitization-report-query.dto';

/**
 * Same ULB / state / year / docType / auditType filters as the AFS dashboard, plus
 * filters on the v3 digitization result written by the AFS digitization v3 queue.
 */
export class AfsDigitizationV3QueryDto extends DigitizationReportQueryDto {
  @ApiPropertyOptional({ description: 'Filter by v3 digitization status', enum: DigitizationV3Statuses })
  @IsOptional()
  @IsEnum(DigitizationV3Statuses)
  digitizationV3Status?: DigitizationV3Statuses;

  @ApiPropertyOptional({ description: 'Only files containing more than one doc type (true) or exactly one (false)' })
  @IsOptional()
  @IsBoolean()
  isConsolidated?: boolean;

  @ApiPropertyOptional({ description: 'Only files whose contents differ from the uploaded doc type (true) or match (false)' })
  @IsOptional()
  @IsBoolean()
  isMismatch?: boolean;

  @ApiPropertyOptional({ description: 'Only files digitized at or after this time (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  digitizedFrom?: string;

  @ApiPropertyOptional({ description: 'Only files digitized at or before this time (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  digitizedTo?: string;

  @ApiPropertyOptional({ description: 'Column to sort by; rows with no value come last', enum: ['digitizedAt', 'pages'] })
  @IsOptional()
  @IsIn(['digitizedAt', 'pages'])
  sortColumn?: 'digitizedAt' | 'pages';

  @ApiPropertyOptional({ description: 'Sort direction (default desc)', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}
