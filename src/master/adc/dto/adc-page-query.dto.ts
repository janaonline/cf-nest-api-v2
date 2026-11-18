import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ADC_PAGE_LIMIT_DEFAULT, ADC_PAGE_LIMIT_MAX } from '../adc.constants';
import { trimString } from './create-adc.dto';

/** Paging for the ADC tables. Not PaginationDto: that allows 100 rows; here a larger limit is cut to the max. */
export class AdcPageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    default: ADC_PAGE_LIMIT_DEFAULT,
    minimum: 1,
    description: `Rows per page, capped at ${ADC_PAGE_LIMIT_MAX}`,
  })
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }: { value: unknown }) => Math.min(Number(value), ADC_PAGE_LIMIT_MAX))
  @IsInt()
  @Min(1)
  limit: number = ADC_PAGE_LIMIT_DEFAULT;

  @ApiPropertyOptional({ example: 1, description: 'Sort direction: ascending 1, descending -1' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, -1])
  sortDir?: 1 | -1;
}

/** Free-text search shared by the ADC tables; the services escape it before building a regex. */
export class AdcSearchPageQueryDto extends AdcPageQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive part-match' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  search?: string;
}
