import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class GetEulbPostSubmissionUpdateRowsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  @IsIn(['Constituted', 'Not Constituted', 'Exempt'])
  electedBodyStatus?: string;

  @IsOptional()
  @IsString()
  @IsIn(['VALID', 'INVALID'])
  validationStatus?: 'VALID' | 'INVALID';
}
