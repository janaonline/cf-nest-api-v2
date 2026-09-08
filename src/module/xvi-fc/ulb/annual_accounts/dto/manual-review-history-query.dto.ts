import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';
import type { ManualReviewRequestStatus } from '../../../../../schemas/xvi-fc/manual-review-request.schema';

/** ADMIN's global (cross-ULB, cross-design-year) manual-review audit trail — every request
 *  regardless of status, sourced straight from xvifc_ac_manual_review_requests. */
export class ManualReviewHistoryQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'RETURNED'])
  status?: ManualReviewRequestStatus;

  @IsOptional()
  @IsMongoId()
  stateId?: string;

  @IsOptional()
  @IsDateString()
  requestedFrom?: string;

  @IsOptional()
  @IsDateString()
  requestedTo?: string;

  @IsOptional()
  @IsDateString()
  decidedFrom?: string;

  @IsOptional()
  @IsDateString()
  decidedTo?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  breachedOnly?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
