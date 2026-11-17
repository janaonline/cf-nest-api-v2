import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, IsString, Min, MaxLength } from 'class-validator';

/** The Portal Admin's ADC list. Not PaginationDto: that allows 100 rows; here a larger limit is cut to 20. */
export class AdcListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, description: 'Rows per page, capped at 20' })
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }: { value: unknown }) => Math.min(Number(value), 20))
  @IsInt()
  @Min(1)
  limit: number = 20;

  @ApiPropertyOptional({ description: "Only this state's ADCs" })
  @IsOptional()
  @IsMongoId()
  stateId?: string;

  @ApiPropertyOptional({ description: 'Part of the ADC name, case-insensitive' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;
}
