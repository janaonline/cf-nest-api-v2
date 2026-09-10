import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { UlbSubmissionsQueryBaseDto } from 'src/module/xvi-fc/common/dto/ulb-submissions-query-base.dto';

const STATUS_FILTER_VALUES = [
  FORM_STATUS.NOT_STARTED,
  FORM_STATUS.IN_PROGRESS,
  FORM_STATUS.UNDER_REVIEW_BY_STATE,
  FORM_STATUS.RETURNED_BY_STATE,
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.RETURNED_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
  FORM_STATUS.APPROVED_BY_STATE,
  FORM_STATUS.AWAITING_CLAIM_LETTER,
] as const;

export class SlbUlbSubmissionsQueryDto extends UlbSubmissionsQueryBaseDto {
  // Accepts a comma-separated list of numeric FORM_STATUS values, e.g. status=2,4,6 — lets one
  // "bucket" (like a stat card) group several underlying statuses in a single filter. Mirrors
  // BankAccountUlbSubmissionsQueryDto exactly (same status vocabulary, same list shape).
  @IsOptional()
  @Transform(({ value }): number[] | undefined =>
    typeof value === 'string' ? value.split(',').filter(Boolean).map(Number) : (value as number[] | undefined),
  )
  @IsIn(STATUS_FILTER_VALUES, { each: true })
  status?: (typeof STATUS_FILTER_VALUES)[number][];
}
