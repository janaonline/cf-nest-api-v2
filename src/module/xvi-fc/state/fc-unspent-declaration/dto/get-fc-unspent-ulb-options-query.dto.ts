import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { FC_UNSPENT_PAGINATION_MAX_LIMIT } from '../constants/fc-unspent-declaration.constants';

export class GetFcUnspentUlbOptionsQueryDto {
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
}
