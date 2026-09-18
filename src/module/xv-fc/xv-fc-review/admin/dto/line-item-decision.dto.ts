import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';

export const ADMIN_LINE_ITEM_DECISION = ['ACCEPTED', 'REJECTED'] as const;
export type AdminLineItemDecision = (typeof ADMIN_LINE_ITEM_DECISION)[number];

export class LineItemDecisionDto {
  @ApiProperty({ enum: ADMIN_LINE_ITEM_DECISION })
  @IsIn(ADMIN_LINE_ITEM_DECISION)
  decision: AdminLineItemDecision;

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
    example: 5000000,
    description:
      'Overwrites the line item value on ACCEPTED — optional, since a flagged item with no ' +
      'original/proposed value at all has nothing to overwrite. Ignored on REJECTED.',
  })
  @ValidateIf((o) => o.decision === 'ACCEPTED')
  @IsNumber()
  @IsOptional()
  correctedValue?: number;
}
