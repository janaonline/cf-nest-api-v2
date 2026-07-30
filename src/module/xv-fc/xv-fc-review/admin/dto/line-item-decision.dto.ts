import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsString, ValidateIf } from 'class-validator';

export const ADMIN_LINE_ITEM_DECISION = ['ACCEPTED', 'REJECTED'] as const;
export type AdminLineItemDecision = (typeof ADMIN_LINE_ITEM_DECISION)[number];

export class LineItemDecisionDto {
  @ApiProperty({ enum: ADMIN_LINE_ITEM_DECISION })
  @IsIn(ADMIN_LINE_ITEM_DECISION)
  decision: AdminLineItemDecision;

  @ApiProperty({ example: 'Verified against original PDF, corrected figure confirmed' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({
    example: 5000000,
    description: 'Required when decision is ACCEPTED — overwrites the line item value',
  })
  @ValidateIf((o) => o.decision === 'ACCEPTED')
  @IsNumber()
  correctedValue?: number;
}
