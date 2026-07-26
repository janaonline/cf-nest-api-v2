import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ROW_STATUS } from 'src/common/constants/row-status.constants';
import type { RowStatusType } from 'src/common/constants/row-status.constants';
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
  @IsIn(Object.values(ROW_STATUS))
  rowStatus?: RowStatusType;

  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    value === 'true' || value === true ? true : value === 'false' || value === false ? false : value,
  )
  @IsBoolean()
  eligibility?: boolean;
}
