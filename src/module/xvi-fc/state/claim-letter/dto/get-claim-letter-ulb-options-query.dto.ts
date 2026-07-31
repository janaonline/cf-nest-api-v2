import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';
import { CLAIM_LETTER_PAGINATION_MAX_LIMIT } from '../constants/claim-letter.constants';

export class GetClaimLetterUlbOptionsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['ELIGIBLE', 'INELIGIBLE'])
  eligibilityFilter?: 'ELIGIBLE' | 'INELIGIBLE';

  // Excludes this draft's own locks from the "locked elsewhere" filter, so a draft's already-
  // selected ULBs still show as eligible/selectable (plan §6.1).
  @IsOptional()
  @IsMongoId()
  claimLetterId?: string;

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
