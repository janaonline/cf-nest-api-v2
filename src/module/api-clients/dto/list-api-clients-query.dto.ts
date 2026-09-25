import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListApiClientsQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit: number = 20;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'REVOKED'], description: 'Filter by status' })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'REVOKED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'REVOKED';

  @ApiPropertyOptional({ enum: ['STATE', 'ULB'], description: 'Filter by actor type' })
  @IsOptional()
  @IsIn(['STATE', 'ULB'])
  actorType?: 'STATE' | 'ULB';

  @ApiPropertyOptional({ description: 'Search by clientId or name (case-insensitive)', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
