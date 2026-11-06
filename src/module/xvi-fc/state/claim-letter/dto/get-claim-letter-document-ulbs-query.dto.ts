import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import type { ClaimLetterListKey } from '../types/claim-letter-document.types';

export class GetClaimLetterDocumentUlbsQueryDto {
  @ApiProperty({ enum: ['ELIGIBLE', 'INELIGIBLE'] })
  @IsIn(['ELIGIBLE', 'INELIGIBLE'])
  list!: ClaimLetterListKey;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
