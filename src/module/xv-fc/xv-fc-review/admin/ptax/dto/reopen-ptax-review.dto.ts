import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ReopenPtaxReviewDto {
  @ApiPropertyOptional({
    example: 'Please re-check metric 1.9, supporting document was unclear',
    description: 'Optional note visible to the ULB explaining why this was reopened',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
