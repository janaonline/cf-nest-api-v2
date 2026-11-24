import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  MOHUA_CLAIM_LETTER_ULBS_MAX_LIMIT,
  MOHUA_ULB_ELIGIBILITY_FILTERS,
  MOHUA_ULB_ELIGIBILITY_LETTER_STATUSES,
  MOHUA_ULB_ELIGIBILITY_MAX_LIMIT,
} from './mohua-claim-letters.constants';

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

/** ULB Eligibility page filters. Search matches the name and the shown code (census, else SB); the service
 *  regex-escapes it. */
export class GetMohuaUlbEligibilityQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(MOHUA_ULB_ELIGIBILITY_FILTERS)
  eligibility?: (typeof MOHUA_ULB_ELIGIBILITY_FILTERS)[number];

  /** A batch number (1-10) or NONE for ULBs in no letter. */
  @IsOptional()
  @Matches(/^(NONE|[1-9]|10)$/, { message: 'batch must be 1 to 10 or NONE' })
  batch?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn(MOHUA_ULB_ELIGIBILITY_LETTER_STATUSES)
  letterStatus?: number;

  /** A criterion type, or NO_ALLOCATION. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  condition?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MOHUA_ULB_ELIGIBILITY_MAX_LIMIT)
  limit?: number;

  /** Rebuilds the cached condition check. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  refresh?: boolean;
}
