import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional, ValidateIf } from 'class-validator';
import { YEARS } from 'src/shared/files/constant';

export class QueryResourcesSectionDto {
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
    description:
      'Population category: 4M+ | 1M-4M | 500K-1M | 100K-500K | <100K',
    example: '500K-1M',
  })
  @IsOptional()
  @IsIn(['4M+', '1M-4M', '500K-1M', '100K-500K', '<100K'])
  popCat: string;

  @ApiPropertyOptional({
    description: 'Audit year',
    example: '2021-22',
  })
  @IsIn(Object.keys(YEARS), {
    message: 'year must be between 2015-16 and 2026-27',
  })
  year: string;

  @ApiPropertyOptional({
    description: 'Audit type: audited | unAudited',
    example: 'audited',
  })
  @ValidateIf((o: QueryResourcesSectionDto) =>
    ['rawPdf', 'standardizedExcel'].includes(o.downloadType),
  )
  @IsIn(['audited', 'unAudited'])
  auditType: 'audited' | 'unAudited' = 'audited';

  @ApiPropertyOptional({
    description: 'Download type: rawPdf | standardizedExcel | budget',
    example: 'rawPdf',
  })
  @IsIn(['rawPdf', 'standardizedExcel', 'budget'])
  downloadType: 'rawPdf' | 'standardizedExcel' | 'budget';
}
