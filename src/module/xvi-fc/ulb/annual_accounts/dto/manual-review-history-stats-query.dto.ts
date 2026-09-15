import { IsIn, IsOptional } from 'class-validator';

export type ManualReviewHistoryStatsRange = 'today' | 'week' | 'all';

/** ADMIN's summary-stats query for the manual-review history page's REQUESTED time-range tabs. */
export class ManualReviewHistoryStatsQueryDto {
  @IsOptional()
  @IsIn(['today', 'week', 'all'])
  range: ManualReviewHistoryStatsRange = 'all';
}
