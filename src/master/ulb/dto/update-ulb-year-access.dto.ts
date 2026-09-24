import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, ValidateIf } from 'class-validator';

/** xvi-fc dynamic year access - admin-set facts for one ULB. Both fields optional/patch-style. */
export class UpdateUlbYearAccessDto {
  @ApiPropertyOptional({
    description:
      'Starting calendar year of this ULB first participating design year. null clears it (no restriction - sees every year).',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o: UpdateUlbYearAccessDto) => o.startYear !== null)
  @IsInt()
  startYear?: number | null;

  @ApiPropertyOptional({
    description:
      'formIds this ULB lacks prior data for, from the currently-exemptable list (GET master/form-json-config/exemptable).',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  disabledFormIds?: number[];
}
