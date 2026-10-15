import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { DigitizationV3Statuses } from 'src/schemas/afs/enums';
import { DigitizationReportQueryDto } from './digitization-report-query.dto';

/**
 * Same ULB / state / year / docType / auditType filters as the AFS dashboard, plus
 * filters on the digitizationV3 result written by the digitizationV3 queue.
 */
export class AfsDigitizationV3QueryDto extends DigitizationReportQueryDto {
  @ApiPropertyOptional({ description: 'Filter by digitizationV3 status', enum: DigitizationV3Statuses })
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
}
