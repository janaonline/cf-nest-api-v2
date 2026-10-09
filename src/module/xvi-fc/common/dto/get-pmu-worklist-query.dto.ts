import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';
import { PMU_WORKLIST_PAGINATION_MAX_LIMIT } from '../constants/pmu-worklist-pagination.constants';

/** Shared by all 5 PMU modules' `GET worklist/:yearId` — filters/sorts/paginates the cross-state
 *  worklist server-side. `sortBy` is validated loosely (any `PmuWorklistRow` key) since each PMU
 *  module's worklist table configures its own sortable columns. */
export class GetPmuWorklistQueryDto {
  @IsOptional()
  @IsMongoId()
  stateId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number;

  @IsOptional()
  @IsString()
  sortBy?: string;

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
  @Max(PMU_WORKLIST_PAGINATION_MAX_LIMIT)
  limit?: number;
}
