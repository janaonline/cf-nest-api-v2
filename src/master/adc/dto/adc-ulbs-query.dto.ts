import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { AdcSearchPageQueryDto } from './adc-page-query.dto';

export const ADC_ULB_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXISTING'] as const;
export const ADC_ULB_SORTS = ['name', 'code'] as const;

/** An ADC's ULBs for the Portal Admin. `search` matches name or code. */
export class AdcUlbsQueryDto extends AdcSearchPageQueryDto {
  @ApiPropertyOptional({ description: 'ULB type id' })
  @IsOptional()
  @IsMongoId()
  ulbType?: string;

  @ApiPropertyOptional({ enum: ADC_ULB_APPROVAL_STATUSES, description: 'EXISTING: legacy ULB with no approval record' })
  @IsOptional()
  @IsIn(ADC_ULB_APPROVAL_STATUSES)
  approvalStatus?: (typeof ADC_ULB_APPROVAL_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: ADC_ULB_SORTS, default: 'name' })
  @IsOptional()
  @IsIn(ADC_ULB_SORTS)
  sortBy?: (typeof ADC_ULB_SORTS)[number];
}
