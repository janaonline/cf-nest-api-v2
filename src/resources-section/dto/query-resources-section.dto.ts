import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  ValidateIf,
} from 'class-validator';

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
    description: 'Audit yearId',
    example: '606aaf854dff55e6c075d219',
  })
  @IsNotEmpty()
  @IsMongoId()
  year: string;

  @ApiPropertyOptional({
    description: 'Audit type: audited | unAudited',
    example: 'audited',
  })
  @ValidateIf((o: QueryResourcesSectionDto) =>
    ['rawPdf', 'standardizedExcel'].includes(o.downloadType),
  )
  @IsIn(['audited', 'unAudited'])
  auditType: 'audited' | 'unAudited';

  @ApiPropertyOptional({
    description: 'Download type: rawPdf | standardizedExcel | budget',
    example: 'rawPdf',
  })
  @IsIn(['rawPdf', 'standardizedExcel', 'budget'])
  downloadType: 'rawPdf' | 'standardizedExcel' | 'budget';
}
