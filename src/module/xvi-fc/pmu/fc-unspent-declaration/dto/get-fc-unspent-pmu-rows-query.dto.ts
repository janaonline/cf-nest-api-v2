import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ROW_REVIEW_STATUS_VALUES } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import { FC_UNSPENT_PMU_PAGINATION_MAX_LIMIT } from '../constants/fc-unspent-pmu-review.constants';

export class GetFcUnspentPmuRowsQueryDto {
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
  @Max(FC_UNSPENT_PMU_PAGINATION_MAX_LIMIT)
  limit?: number;

  /** Accepts a comma-separated list (e.g. `rowStatus=5,6,7` for the "Approved" bucket, which spans
   *  multiple underlying statuses once MoHUA's own rows reviewer is involved) as well as a single
   *  value — both arrive as a string over HTTP. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.split(',').map((v) => Number(v.trim())) : value,
  )
  @IsIn(ROW_REVIEW_STATUS_VALUES, { each: true })
  rowStatus?: RowReviewStatus[];

  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    value === 'true' || value === true ? true : value === 'false' || value === false ? false : value,
  )
  @IsBoolean()
  eligibility?: boolean;

  @IsOptional()
  @IsIn(['ulbName', 'rowStatus'])
  sortBy?: 'ulbName' | 'rowStatus';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
