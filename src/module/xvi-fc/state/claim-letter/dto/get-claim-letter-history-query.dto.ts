import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CLAIM_LETTER_PAGINATION_MAX_LIMIT } from '../constants/claim-letter.constants';

export class GetClaimLetterHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2])
  installment?: 1 | 2;

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
