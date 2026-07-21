import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { UlbSubmissionsQueryBaseDto } from 'src/module/xvi-fc/common/dto/ulb-submissions-query-base.dto';

const STATUS_FILTER_VALUES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'UNDER_REVIEW_BY_STATE',
  'RETURNED_BY_STATE',
  'UNDER_REVIEW_BY_MOHUA',
  'RETURNED_BY_MOHUA',
  'SUBMISSION_ACKNOWLEDGED_BY_MOHUA',
] as const;

export class UlbSubmissionsQueryDto extends UlbSubmissionsQueryBaseDto {
  @IsIn(['auditedData', 'unauditedData'])
  section: 'auditedData' | 'unauditedData';

  // Accepts a comma-separated list, e.g. status=IN_PROGRESS,RETURNED_BY_STATE — lets one
  // "bucket" (like a stat card) group several underlying statuses in a single filter.
  @IsOptional()
  @Transform(({ value }): string[] | undefined =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : (value as string[] | undefined),
  )
  @IsIn(STATUS_FILTER_VALUES, { each: true })
  status?: (typeof STATUS_FILTER_VALUES)[number][];
}
