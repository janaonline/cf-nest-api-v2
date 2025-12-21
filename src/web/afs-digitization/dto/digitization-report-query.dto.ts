// digitization-report-query.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsMongoId, IsOptional, Min } from 'class-validator';
import { DigitizationStatuses } from 'src/schemas/afs/afs-excel-file.schema';

export enum AuditType {
  AUDITED = 'audited',
  UNAUDITED = 'unaudited',
}

export enum DocumentType {
  BALANCE_SHEET = 'bal_sheet',
  BALANCE_SHEET_SCHEDULE = 'bal_sheet_schedules',
  INCOME_AND_EXPENDITURE = 'inc_exp',
  INCOME_AND_EXPENDITURE_SCHEDULE = 'inc_exp_schedules',
  CASHFLOW_STATEMENT = 'cash_flow',
  AUDITORS_REPORT = 'auditor_report',
}

export enum PopulationCategoryies {
  NULL = '',
  ALL = 'all',
  LESS_THAN_100K = '<100K',
  BETWEEN_100K_AND_500K = '100K-500K',
  BETWEEN_500K_AND_1M = '500K-1M',
  BETWEEN_1M_AND_4M = '1M-4M',
  MORE_THAN_4M = '4M+',
}

export class DigitizationReportQueryDto {
  // @ApiProperty({
  //   description: 'Array of state ObjectIds',
  //   example: ['606aaf854dff55e6c075d219', '5dd247914f14901fa9b4a85d'],
  //   isArray: true,
  //   type: String,
  // })
  // @IsArray()
  // @IsMongoId({ each: true, message: 'Each stateId must be a valid MongoDB ObjectId' })
  // @Transform(({ value }) => {
  //   // Handle single string or array
  //   if (!value) return [];
  //   if (Array.isArray(value)) return value.map((v) => String(v));
  //   return [String(value)];
  // })
  // @IsOptional()
  // stateId?: string[];

  @ApiPropertyOptional({
    description: 'Optional array of state ObjectIds',
    example: ['606aaf854dff55e6c075d219', '5dd247914f14901fa9b4a85d'],
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true, message: 'Each stateId must be a valid MongoDB ObjectId' })
  @Transform(
    ({ value }) => {
      if (value === undefined || value === null || value === '') return undefined;

      // Query string: stateId=...&stateId=...
      if (Array.isArray(value)) return value.map((v) => String(v));

      // Single value: stateId=...
      return [String(value)];
    },
    { toClassOnly: true },
  )
  stateId?: string[];

  @ApiProperty({
    description: 'Year ObjectId from years collection (e.g. audited.year)',
    // example: '606aaf854dff55e6c075d219',
    example: '606aadac4dff55e6c075c507',
  })
  @IsMongoId()
  // @Transform(({ value }) => (value ? new Types.ObjectId(String(value)) : undefined), { toClassOnly: true })
  yearId: string;

  // @ApiPropertyOptional({
  //   description: 'ULB ObjectId (optional, if omitted fetch all ULBs for that year)',
  //   example: '5dd247914f14901fa9b4a85d',
  // })
  // @IsMongoId()
  // @IsOptional()
  // // @Transform(({ value }) => new Types.ObjectId(String(value)), { toClassOnly: true })
  // ulbId?: string;

  @ApiPropertyOptional({
    description: 'Optional array of ulbId ObjectIds',
    example: ['5dd247914f14901fa9b4a85d'],
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true, message: 'Each ulbId must be a valid MongoDB ObjectId' })
  @Transform(
    ({ value }) => {
      if (value === undefined || value === null || value === '') return undefined;

      // Query string: ulbId=...&ulbId=...
      if (Array.isArray(value)) return value.map((v) => String(v));

      // Single value: ulbId=...
      return [String(value)];
    },
    { toClassOnly: true },
  )
  ulbId?: string[];

  //   @ApiPropertyOptional({
  //     description: 'State ObjectId to filter by state (optional)',
  //     example: '5dcf9d7216a06aed41c748e2',
  //   })
  //   @IsMongoId()
  //   @IsOptional()
  //   stateId?: string;

  @ApiPropertyOptional({
    description: 'Filter by auditType (audited / unaudited)',
    example: 'audited',
    enum: AuditType,
  })
  @IsEnum(AuditType)
  @IsOptional()
  auditType?: AuditType;

  @ApiPropertyOptional({
    description: 'Filter by digitizationStatus',
    example: 'not-digitized',
    enum: DigitizationStatuses,
  })
  @IsOptional()
  @IsEnum(DigitizationStatuses)
  digitizationStatus?: DigitizationStatuses;

  @ApiPropertyOptional({
    description: 'Filter by populationCategory',
    example: '1M-4M',
    enum: PopulationCategoryies,
  })
  @IsOptional()
  @IsEnum(PopulationCategoryies)
  populationCategory?: PopulationCategoryies;

  @ApiPropertyOptional({
    description: 'Filter by document type (e.g. "bal_sheet")',
    example: 'bal_sheet',
    enum: DocumentType,
  })
  @IsEnum(DocumentType)
  docType: string;

  @ApiPropertyOptional({
    description: 'Sort by field (not implemented)',
    example: 'ulbDoc.name',
  })
  @IsOptional()
  @IsEnum(['ulbDoc.name'] as const, { message: 'sortBy must be a valid field name' })
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Sort order: asc or desc (not implemented)',
    example: 'asc',
    default: 'asc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'] as const, { message: 'sortOrder must be either "asc" or "desc"' })
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description: 'Page number for pagination (1-based)',
    default: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Page size (limit)',
    default: 100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit: number = 100;
}
