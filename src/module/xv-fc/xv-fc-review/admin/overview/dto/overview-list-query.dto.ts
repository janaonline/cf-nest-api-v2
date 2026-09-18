import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Derived, not stored — see XvFcReviewOverviewService.OVERALL_STATUS_STAGE for the exact rule
// (ported from the approved admin dashboard prototype's `overallStatus()`).
export const OVERVIEW_OVERALL_STATUS = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'VERIFYING',
  'PARTIAL',
  'APPROVED',
  'REJECTED',
] as const;
export type OverviewOverallStatus = (typeof OVERVIEW_OVERALL_STATUS)[number];

const SORT_FIELDS = ['ulb', 'state', 'censusCode'] as const;

export class OverviewListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'A partial/full state name (e.g. "Kerala" or "Kera"), a state code (e.g. "KL"), or the state\'s ObjectId — any of the three is accepted',
  })
  @IsOptional()
  @IsString()
  stateName?: string;

  @ApiPropertyOptional({ description: 'Partial match against the ULB’s census code' })
  @IsOptional()
  @IsString()
  censusCode?: string;

  @ApiPropertyOptional({ description: 'Matches against ULB name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: OVERVIEW_OVERALL_STATUS })
  @IsOptional()
  @IsIn(OVERVIEW_OVERALL_STATUS)
  overallStatus?: OverviewOverallStatus;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'ulb' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
