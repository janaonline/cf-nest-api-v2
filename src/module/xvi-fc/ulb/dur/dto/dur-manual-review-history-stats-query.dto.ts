import { IsIn, IsOptional } from 'class-validator';

export type DurManualReviewHistoryStatsRange = 'today' | 'week' | 'all';

/** ADMIN's summary-stats query for the DUR manual-review history page's REQUESTED time-range tabs. */
export class DurManualReviewHistoryStatsQueryDto {
  @IsOptional()
  @IsIn(['today', 'week', 'all'])
  range: DurManualReviewHistoryStatsRange = 'all';
}
