import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DF_PMU_PAGINATION_MAX_LIMIT } from '../constants/devolution-formula-pmu-review.constants';

export class GetDevolutionFormulaPmuRowsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DF_PMU_PAGINATION_MAX_LIMIT)
  limit?: number;
}
