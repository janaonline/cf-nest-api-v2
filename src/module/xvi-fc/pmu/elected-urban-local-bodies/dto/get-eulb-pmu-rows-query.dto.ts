import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ROW_REVIEW_STATUS_VALUES } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import { EULB_PMU_PAGINATION_MAX_LIMIT } from '../constants/elected-urban-local-bodies-pmu-review.constants';

export class GetEulbPmuRowsQueryDto {
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
  @Max(EULB_PMU_PAGINATION_MAX_LIMIT)
  limit?: number;

  /** Accepts a comma-separated list (e.g. `rowStatus=5,6,7` for the "Approved" bucket) as well as a
   *  single value — both arrive as a string over HTTP. EULB only ever populates one of the 3
   *  "Approved" codes in practice (no MoHUA reviewer touches its rows), but the shape is kept
   *  identical to FC Unspent's own for consistency. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.split(',').map((v) => Number(v.trim())) : value,
  )
  @IsIn(ROW_REVIEW_STATUS_VALUES, { each: true })
  rowStatus?: RowReviewStatus[];

  @IsOptional()
  @IsIn(['ulbName', 'rowStatus'])
  sortBy?: 'ulbName' | 'rowStatus';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
