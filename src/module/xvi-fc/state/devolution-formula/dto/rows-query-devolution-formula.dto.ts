import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import {
  DF_PAGINATION_DEFAULT_LIMIT,
  DF_PAGINATION_DEFAULT_PAGE,
  DF_PAGINATION_MAX_LIMIT,
} from '../constants/devolution-formula.constants';

export class RowsQueryDevolutionFormulaDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = DF_PAGINATION_DEFAULT_PAGE;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = DF_PAGINATION_DEFAULT_LIMIT;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['VALID', 'INVALID'])
  validationStatus?: 'VALID' | 'INVALID';
}

export { DF_PAGINATION_MAX_LIMIT };
