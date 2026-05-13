import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsNotEmpty, IsOptional } from 'class-validator';
import { YearLabels } from 'src/core/constants/years';

export class AuditorReportDto {
  @ApiProperty({
    description: 'UlbId for which the report has to be fetched',
    example: '5eb5844f76a3b61f40ba069e',
  })
  @IsMongoId()
  @IsNotEmpty()
  ulbId: string;

  @ApiPropertyOptional({
    description: 'YearId for which the report has to be fetched',
    example: '606aadac4dff55e6c075c507',
  })
  @IsMongoId()
  @IsOptional()
  yearId?: string;

  @ApiPropertyOptional({
    description: 'Year for which the report has to be fetched',
    example: '2020-21',
  })
  @IsIn(YearLabels)
  @IsOptional()
  year?: string;
}
