import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MOHUA_STATE_ULBS_MAX_LIMIT } from './mohua-overview.constants';

export const MOHUA_STATE_ULBS_SORT_FIELDS = ['ulbName', 'allocation'] as const;
export type MohuaStateUlbsSortField = (typeof MOHUA_STATE_ULBS_SORT_FIELDS)[number];

/** Query of `GET xvi-fc/mohua/state/:stateId/:yearId/ulbs` — search, sort and page the state's ULBs server-side. */
export class GetMohuaStateUlbsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(MOHUA_STATE_ULBS_SORT_FIELDS)
  sortBy?: MohuaStateUlbsSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MOHUA_STATE_ULBS_MAX_LIMIT)
  limit?: number;
}
