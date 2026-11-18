import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { AdcSearchPageQueryDto } from './adc-page-query.dto';

export const ADC_MEMBER_LEVELS = ['ADMIN', 'EDITOR', 'VIEWER'] as const;
export const ADC_MEMBER_STATUSES = ['ACTIVE', 'INVITED'] as const;
export const ADC_MEMBER_SORTS = ['name', 'lastActive'] as const;

/** An ADC's members for the Portal Admin. `search` matches name, email or mobile. */
export class AdcMembersQueryDto extends AdcSearchPageQueryDto {
  @ApiPropertyOptional({ enum: ADC_MEMBER_LEVELS, description: 'ADMIN, EDITOR (Reviewer) or VIEWER' })
  @IsOptional()
  @IsIn(ADC_MEMBER_LEVELS)
  level?: (typeof ADC_MEMBER_LEVELS)[number];

  @ApiPropertyOptional({ enum: ADC_MEMBER_STATUSES, description: 'ACTIVE: profile verified, INVITED: not yet' })
  @IsOptional()
  @IsIn(ADC_MEMBER_STATUSES)
  status?: (typeof ADC_MEMBER_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Leave out the current Admin (Change Admin)' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  excludeAdmin?: boolean;

  @ApiPropertyOptional({ enum: ADC_MEMBER_SORTS, default: 'name' })
  @IsOptional()
  @IsIn(ADC_MEMBER_SORTS)
  sortBy?: (typeof ADC_MEMBER_SORTS)[number];
}
