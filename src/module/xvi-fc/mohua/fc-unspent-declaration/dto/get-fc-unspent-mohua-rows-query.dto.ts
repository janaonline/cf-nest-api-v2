import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ROW_REVIEW_STATUS_VALUES } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import type { RowReviewStatus } from 'src/module/xvi-fc/common/constants/row-review-status.constants';
import { FC_UNSPENT_PAGINATION_MAX_LIMIT } from 'src/module/xvi-fc/state/fc-unspent-declaration/constants/fc-unspent-declaration.constants';

export class GetFcUnspentMohuaRowsQueryDto {
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
  @Max(FC_UNSPENT_PAGINATION_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn(ROW_REVIEW_STATUS_VALUES)
  rowStatus?: RowReviewStatus;

  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    value === 'true' || value === true ? true : value === 'false' || value === false ? false : value,
  )
  @IsBoolean()
  eligibility?: boolean;
}
