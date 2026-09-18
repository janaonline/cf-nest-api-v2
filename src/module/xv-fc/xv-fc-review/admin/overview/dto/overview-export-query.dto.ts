import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { OVERVIEW_OVERALL_STATUS } from './overview-list-query.dto';
import type { OverviewOverallStatus } from './overview-list-query.dto';

export class OverviewExportQueryDto {
  @ApiPropertyOptional({
    description:
      'A partial/full state name (e.g. "Kerala" or "Kera"), a state code (e.g. "KL"), or the state\'s ObjectId — any of the three is accepted',
  })
  @IsOptional()
  @IsString()
  stateName?: string;

  @ApiPropertyOptional({ description: 'Partial match against the ULB’s census code' })
  @IsOptional()
  @IsString()
  censusCode?: string;

  @ApiPropertyOptional({ description: 'Matches against ULB name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: OVERVIEW_OVERALL_STATUS })
  @IsOptional()
  @IsIn(OVERVIEW_OVERALL_STATUS)
  overallStatus?: OverviewOverallStatus;
}
