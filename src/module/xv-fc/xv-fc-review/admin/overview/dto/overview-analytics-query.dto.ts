import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

const OVERVIEW_ANALYTICS_FORM = ['afs', 'ptax'] as const;

export class OverviewAnalyticsQueryDto {
  @ApiPropertyOptional({
    enum: OVERVIEW_ANALYTICS_FORM,
    description: 'Restrict the KPI counts to one form; omit for both forms combined',
  })
  @IsOptional()
  @IsIn(OVERVIEW_ANALYTICS_FORM)
  form?: (typeof OVERVIEW_ANALYTICS_FORM)[number];
}
