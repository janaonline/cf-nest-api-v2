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
      'Filter by approval status. STATE users are always scoped to PENDING+APPROVED+REJECTED+EXISTING within ' +
      "their own state. 'EXISTING' matches legacy ULBs created before the approval workflow existed (no " +
      "'approval' field stored at all), distinct from an ADMIN-reviewed 'APPROVED' ULB.",
  })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'EXISTING'])
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXISTING';

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
