import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, Max, IsIn, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { EventStatus } from 'src/schemas/events.schema';

const allowedEventStatus = Object.values(EventStatus).filter(
  (e) => typeof e === 'number' && e !== EventStatus.INACTIVE,
);

export class FindEventDto {
  @ApiPropertyOptional({
    example: 'webinar',
    description: 'Search by Event title',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    example: EventStatus.ACTIVE,
    description: 'Status of the event. Allowed values are: 1 (Active), 2 (Draft).',
  })
  @IsOptional()
  @IsIn(allowedEventStatus)
  @Type(() => Number)
  eventStatus: EventStatus;

  @ApiPropertyOptional({
    example: 'startAt',
    description: 'Sort by Event title, Event state date or Event end date.',
  })
  @IsOptional()
  @IsIn(['startAt', 'createdAt', 'title'])
  sortBy?: 'startAt' | 'createdAt' | 'title' = 'startAt';

  @ApiPropertyOptional({
    example: 1,
    description: 'Sort direction: ascending: 1, descending: -1.',
  })
  @IsOptional()
  @IsIn([1, -1])
  @Type(() => Number)
  sortDir?: 1 | -1 = 1;

  @ApiPropertyOptional({
    example: 1,
    description: 'Page number (must be >= 1)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    example: 10,
    description: 'Number of items per page (limit)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit: number = 10;
}
