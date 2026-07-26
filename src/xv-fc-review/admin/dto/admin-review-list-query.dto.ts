import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { XV_FC_REVIEW_STATUS } from '../../../schemas/ledger-log.schema';
import type { XvFcReviewStatus } from '../../../schemas/ledger-log.schema';

const SORT_FIELDS = ['ulb', 'financialYear', 'state', 'submittedAt'] as const;

export class AdminReviewListQueryDto {
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

  @ApiPropertyOptional({ enum: XV_FC_REVIEW_STATUS })
  @IsOptional()
  @IsIn(XV_FC_REVIEW_STATUS)
  reviewStatus?: XvFcReviewStatus;

  @ApiPropertyOptional({ enum: SORT_FIELDS, default: 'submittedAt' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
