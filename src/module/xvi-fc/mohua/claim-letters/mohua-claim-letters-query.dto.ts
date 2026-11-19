import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MOHUA_CLAIM_LETTER_ULBS_MAX_LIMIT } from './mohua-claim-letters.constants';

export class GetMohuaClaimLetterUlbsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MOHUA_CLAIM_LETTER_ULBS_MAX_LIMIT)
  limit?: number;
}
