// digitization-report-query.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsEnum, IsIn, IsInt, IsMongoId, IsOptional, IsString } from 'class-validator';
import { YearLabels } from 'src/core/constants/years';
import { PopulationCategoryies } from './digitization-report-query.dto';
import { parseMongoIdToArray } from 'src/shared/transforms/parse-mongo-id-array.transform';

export class ResourcesSectionExcelListDto {
  @ApiPropertyOptional({
    description: 'Optional array of state ObjectIds',
    example: ['5dcf9d7516a06aed41c748fe', '5dcf9d7216a06aed41c748e0'],
    isArray: true,
    type: String,
  })
  @Transform(({ value }) => parseMongoIdToArray(value), { toClassOnly: true })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true, message: 'Each stateId must be a valid MongoDB ObjectId' })
  stateId?: string[];

  @ApiPropertyOptional({
    description: 'Year _id (e.g. audited.year)',
    example: '606aadac4dff55e6c075c507',
  })
  @IsOptional()
  @IsMongoId()
  yearId?: string;

  @ApiProperty({
    description: 'Year (e.g. audited.year)',
    example: '2020-21',
  })
  @IsString()
  @IsIn(YearLabels)
  year: string;

  @ApiPropertyOptional({
    description: 'Optional array of ulbId ObjectIds',
    example: ['5dd24729437ba31f7eb42ee4', '5fa2465d072dab780a6f1054'],
    isArray: true,
    type: String,
  })
  @Transform(({ value }) => parseMongoIdToArray(value), { toClassOnly: true })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true, message: 'Each ulbId must be a valid MongoDB ObjectId' })
  ulbId?: string[];

  // @ApiPropertyOptional({
  //   description: 'Filter by auditType (audited/ unaudited)',
  //   example: 'audited',
  //   enum: AuditType,
  // })
  // @IsEnum(AuditType)
  // @IsOptional()
  // auditType?: AuditType;

  // @ApiPropertyOptional({
  //   description: 'Filter by digitizationStatus',
  //   example: 'not-digitized',
  //   enum: DigitizationStatuses,
  // })
  // @IsOptional()
  // @IsEnum(DigitizationStatuses)
  // digitizationStatus?: DigitizationStatuses;

  @ApiPropertyOptional({
    description: 'Filter by populationCategory',
    example: '1M-4M',
    enum: PopulationCategoryies,
  })
  @IsOptional()
  @IsEnum(PopulationCategoryies)
  populationCategory?: PopulationCategoryies;

  @ApiPropertyOptional({
    description: 'Number of records to skip',
    default: 0,
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  skip?: number = 0;

  // @ApiPropertyOptional({
  //   description: 'Filter by document type (e.g. "bal_sheet")',
  //   example: 'bal_sheet',
  //   enum: DocumentType,
  // })
  // @IsEnum(DocumentType)
  // docType: string;

  // @ApiPropertyOptional({
  //   description: 'Page number for pagination (1-based)',
  //   default: 1,
  // })
  // @Type(() => Number)
  // @IsInt()
  // @Min(1)
  // @IsOptional()
  // page: number = 1;

  // @ApiPropertyOptional({
  //   description: 'Page size (limit)',
  //   default: 100,
  // })
  // @Type(() => Number)
  // @IsInt()
  // @IsOptional()
  // limit: number = 100;
}
