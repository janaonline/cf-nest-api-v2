import { Type } from 'class-transformer';
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

  @IsOptional()
  @Type(() => Number)
  @IsIn(ROW_REVIEW_STATUS_VALUES)
  rowStatus?: RowReviewStatus;
}
