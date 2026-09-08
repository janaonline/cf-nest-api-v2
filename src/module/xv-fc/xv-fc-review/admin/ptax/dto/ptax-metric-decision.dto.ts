import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsString, ValidateIf } from 'class-validator';

export const PTAX_METRIC_DECISION = ['ACCEPTED', 'REJECTED'] as const;
export type PtaxMetricDecision = (typeof PTAX_METRIC_DECISION)[number];

export class PtaxMetricDecisionDto {
  @ApiProperty({ enum: PTAX_METRIC_DECISION })
  @IsIn(PTAX_METRIC_DECISION)
  decision: PtaxMetricDecision;

  @ApiProperty({ example: 'Verified against supporting document, corrected figure confirmed' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({
    example: 5000,
    description: 'Required when decision is ACCEPTED — the resolved value recorded for this metric',
  })
  @ValidateIf((o) => o.decision === 'ACCEPTED')
  @IsNumber()
  correctedValue?: number;
}
