import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';
import { CLAIM_LETTER_MAX_ULBS } from '../constants/claim-letter.constants';

export class GetClaimLetterUlbOptionsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  // INELIGIBLE leaves out ULBs in another batch; IN_OTHER_BATCH lists only them.
  @IsIn(['ELIGIBLE', 'INELIGIBLE', 'IN_OTHER_BATCH'])
  eligibilityFilter?: 'ELIGIBLE' | 'INELIGIBLE' | 'IN_OTHER_BATCH';

  // Excludes this draft's own locks from the "locked elsewhere" filter, so a draft's already-
  // selected ULBs still show as eligible/selectable.
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
  // The picker loads every ULB of the State in one call, then searches and pages locally.
  @Max(CLAIM_LETTER_MAX_ULBS)
  limit?: number;
}
