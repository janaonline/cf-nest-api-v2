import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';

export const PTAX_METRIC_DECISION = ['ACCEPTED', 'REJECTED'] as const;
export type PtaxMetricDecision = (typeof PTAX_METRIC_DECISION)[number];

export class PtaxMetricDecisionDto {
  @ApiProperty({ enum: PTAX_METRIC_DECISION })
  @IsIn(PTAX_METRIC_DECISION)
  decision: PtaxMetricDecision;

  @ApiPropertyOptional({
    example: 'Corrected value does not match supporting document',
    description: 'Required when decision is REJECTED — optional (and ignored) on ACCEPTED',
  })
  @ValidateIf((o) => o.decision === 'REJECTED')
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({
    example: 5000,
    description:
      'The resolved value recorded for this metric on ACCEPTED — optional, since a flagged metric ' +
      'with no value at all has nothing to record. Ignored on REJECTED.',
  })
  @ValidateIf((o) => o.decision === 'ACCEPTED')
  @IsNumber()
  @IsOptional()
  correctedValue?: number;
}
