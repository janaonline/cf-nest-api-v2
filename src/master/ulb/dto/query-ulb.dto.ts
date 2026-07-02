import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryUlbDto {
  @ApiPropertyOptional({ description: 'Search by ULB name or code' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by State id' })
  @IsOptional()
  @IsMongoId()
  state?: string;

  @ApiPropertyOptional({ description: 'Filter by ULB type id' })
  @IsOptional()
  @IsMongoId()
  ulbType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Filter by approval status. STATE users are always scoped to PENDING+APPROVED+REJECTED within their own state.',
  })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ example: 'name' })
  @IsOptional()
  @IsIn(['name', 'code', 'createdAt'])
  sortBy?: 'name' | 'code' | 'createdAt' = 'name';

  @ApiPropertyOptional({ example: 1, description: 'Sort direction: ascending: 1, descending: -1.' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, -1])
  sortDir?: 1 | -1 = 1;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}
