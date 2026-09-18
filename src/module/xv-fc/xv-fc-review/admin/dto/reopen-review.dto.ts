import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ReopenReviewDto {
  @ApiPropertyOptional({
    example: 'Please re-check line item 12, supporting document was unclear',
    description: 'Optional note visible to the ULB explaining why this was reopened',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
