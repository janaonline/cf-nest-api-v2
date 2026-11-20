import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  CLAIM_LETTER_HISTORY_SORT_FIELDS,
  CLAIM_LETTER_HISTORY_STATUS_FILTERS,
  CLAIM_LETTER_MAX_LETTERS_LIMIT,
  CLAIM_LETTER_PAGINATION_MAX_LIMIT,
  type ClaimLetterHistorySortField,
  type ClaimLetterHistoryStatusFilter,
} from '../constants/claim-letter.constants';

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

  @IsOptional()
  @IsIn(CLAIM_LETTER_HISTORY_STATUS_FILTERS)
  status?: ClaimLetterHistoryStatusFilter;

  /** "Batch 2" also matches 2-R1, 2-R2 (letters built in that place after a return). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CLAIM_LETTER_MAX_LETTERS_LIMIT)
  batchNumber?: number;

  @IsOptional()
  @IsIn(CLAIM_LETTER_HISTORY_SORT_FIELDS)
  sortBy?: ClaimLetterHistorySortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
