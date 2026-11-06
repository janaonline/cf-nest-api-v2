import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CLAIM_LETTER_MAX_ULBS } from '../constants/claim-letter.constants';

export class GetClaimLetterUlbRowsQueryDto {
  @IsOptional()
  @IsString()
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
  // The detail page loads a whole batch in one call (eligibility here reads the cached build).
  @Max(CLAIM_LETTER_MAX_ULBS)
  limit?: number;
}
