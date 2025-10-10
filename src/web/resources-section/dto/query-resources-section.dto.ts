import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsMongoId, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { YEARS } from 'src/shared/files/constant';

export class QueryResourcesSectionDto {
  @ApiPropertyOptional({
    description: 'User Name',
    example: '',
  })
  @IsNotEmpty()
  @IsString()
  userName: string;

  @ApiPropertyOptional({
    description: 'Email Id',
    example: '',
  })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: 'ULB objectId',
    example: '5dd006d4ffbcc50cfd92c87c',
  })
  @IsOptional()
  @IsMongoId()
  ulb: string;

  @ApiPropertyOptional({
    description: 'State objectId',
    example: '5dcf9d7316a06aed41c748ec',
  })
  @IsOptional()
  @IsMongoId()
  state: string;

  @ApiPropertyOptional({
    description: 'ULB type objectId',
    example: '5dcfa67543263a0e75c71697',
  })
  @IsOptional()
  @IsMongoId()
  ulbType: string;

  @ApiPropertyOptional({
    description: 'Population category: 4M+ | 1M-4M | 500K-1M | 100K-500K | <100K',
    example: '500K-1M',
  })
  @IsOptional()
  @IsIn(['4M+', '1M-4M', '500K-1M', '100K-500K', '<100K'])
  popCat: string;

  @ApiPropertyOptional({
    description: 'Audit year',
    example: '2021-22',
  })
  @IsNotEmpty()
  @IsIn(Object.keys(YEARS), {
    message: 'year must be between 2015-16 and 2026-27',
  })
  year: string;

  @ApiPropertyOptional({
    description: 'Audit type: audited | unAudited',
    example: 'audited',
  })
  @ValidateIf((o: QueryResourcesSectionDto) => ['Raw Data PDF', 'Budget PDF'].includes(o.downloadType))
  @IsIn(['audited', 'unAudited'])
  auditType: 'audited' | 'unAudited' = 'audited';

  @ApiPropertyOptional({
    description: 'Download type: Raw Data PDF | Budget PDF',
    example: 'Raw Data PDF',
  })
  @IsIn(['Raw Data PDF', 'Budget PDF'])
  // downloadType: 'rawPdf' | 'standardizedExcel' | 'budget'; // Change keys as per UI.
  // 'Raw Data PDF' | 'Raw Data Excel' | 'Standardised Excel' | 'Budget PDF'
  downloadType: 'Raw Data PDF' | 'Budget PDF';
}
