import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional } from 'class-validator';
import { AdcSearchPageQueryDto } from './adc-page-query.dto';

export const ADC_ADMIN_STATUSES = ['ACTIVE', 'INVITED', 'NOT_SET'] as const;
export type AdcAdminStatus = (typeof ADC_ADMIN_STATUSES)[number];
export const ADC_LIST_SORTS = ['name', 'state', 'ulbCount', 'memberCount'] as const;

/** The Portal Admin's ADC list. `search` matches the ADC name or the Admin's name or email. */
export class AdcListQueryDto extends AdcSearchPageQueryDto {
  @ApiPropertyOptional({ description: "Only this state's ADCs" })
  @IsOptional()
  @IsMongoId()
  stateId?: string;

  @ApiPropertyOptional({ enum: ADC_ADMIN_STATUSES, description: 'ACTIVE: verified Admin, INVITED: not yet verified' })
  @IsOptional()
  @IsIn(ADC_ADMIN_STATUSES)
  adminStatus?: AdcAdminStatus;

  @ApiPropertyOptional({ enum: ADC_LIST_SORTS, default: 'name' })
  @IsOptional()
  @IsIn(ADC_LIST_SORTS)
  sortBy?: (typeof ADC_LIST_SORTS)[number];
}
