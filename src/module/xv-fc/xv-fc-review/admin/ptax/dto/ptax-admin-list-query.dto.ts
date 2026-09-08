import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PTAX_REVIEW_STATUS } from '../../../../../../schemas/xv-fc-ptax-review.schema';
import type { PtaxReviewStatus } from '../../../../../../schemas/xv-fc-ptax-review.schema';

const SORT_FIELDS = ['ulb', 'financialYear', 'state', 'submittedAt'] as const;

export class PtaxAdminListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Matches against ULB name or ULB code' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'State code, e.g. "KL"' })
  @IsOptional()
  @IsString()
  stateId?: string;

  @ApiPropertyOptional({ example: '2022-23' })
  @IsOptional()
  @IsString()
  financialYear?: string;

  @ApiPropertyOptional({ enum: PTAX_REVIEW_STATUS })
  @IsOptional()
  @IsIn(PTAX_REVIEW_STATUS)
  reviewStatus?: PtaxReviewStatus;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'submittedAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
