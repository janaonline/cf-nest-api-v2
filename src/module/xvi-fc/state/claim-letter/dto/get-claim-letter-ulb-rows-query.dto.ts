import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CLAIM_LETTER_PAGINATION_MAX_LIMIT } from '../constants/claim-letter.constants';

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
  @Max(CLAIM_LETTER_PAGINATION_MAX_LIMIT)
  limit?: number;
}
