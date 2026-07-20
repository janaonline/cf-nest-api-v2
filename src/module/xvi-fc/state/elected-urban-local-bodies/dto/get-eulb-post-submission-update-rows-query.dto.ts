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

  // Not `@IsIn([...])` — that list is DB-driven. An unrecognized value here just yields zero
  // matching rows (a query filter, not a business-rule boundary), so `@IsString()` is sufficient.
  @IsOptional()
  @IsString()
  electedBodyStatus?: string;

  @IsOptional()
  @IsString()
  @IsIn(['VALID', 'INVALID'])
  validationStatus?: 'VALID' | 'INVALID';
}
