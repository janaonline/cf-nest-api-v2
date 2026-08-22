import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsMongoId, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class QuerySideMenuDto {
  @ApiPropertyOptional({ example: 'ULB', description: 'Filter by role' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ example: '6801f2e3a4b5c6d7e8f90123', description: 'Filter by year ObjectId' })
  @IsOptional()
  @IsMongoId()
  yearId?: string;

  @ApiPropertyOptional({ default: false, description: 'Include inactive items (admin use)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}
