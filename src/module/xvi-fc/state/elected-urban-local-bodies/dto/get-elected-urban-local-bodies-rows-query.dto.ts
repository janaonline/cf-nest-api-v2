import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class GetElectedUrbanLocalBodiesRowsQueryDto {
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
  @IsIn(['VALID', 'INVALID'])
  validationStatus?: 'VALID' | 'INVALID';

  @IsOptional()
  @IsString()
  @IsIn(['DB_ULB', 'EXTRA_ULB'])
  rowType?: 'DB_ULB' | 'EXTRA_ULB';

  @IsOptional()
  @IsString()
  errorField?: string;
}
