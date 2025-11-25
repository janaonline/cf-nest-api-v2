// digitization-report-query.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsMongoId, IsOptional, Min } from 'class-validator';
import { Types } from 'mongoose';

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

export class DigitizationReportQueryDto {
  @ApiProperty({
    description: 'Year ObjectId from years collection (e.g. audited.year)',
    example: '606aaf854dff55e6c075d219',
  })
  @IsMongoId()
  // @Transform(({ value }) => (value ? new Types.ObjectId(String(value)) : undefined), { toClassOnly: true })
  yearId: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'ULB ObjectId (optional, if omitted fetch all ULBs for that year)',
    example: '5dd247914f14901fa9b4a85d',
  })
  @IsMongoId()
  @IsOptional()
  // @Transform(({ value }) => new Types.ObjectId(String(value)), { toClassOnly: true })
  ulbId?: Types.ObjectId;

  //   @ApiPropertyOptional({
  //     description: 'State ObjectId to filter by state (optional)',
  //     example: '5dcf9d7216a06aed41c748e2',
  //   })
  //   @IsMongoId()
  //   @IsOptional()
  //   stateId?: string;

  //   @ApiPropertyOptional({
  //     description: 'Filter by auditType (audited / unaudited)',
  //     enum: AuditType,
  //   })
  //   @IsEnum(AuditType)
  //   @IsOptional()
  //   auditType?: AuditType;

  @ApiPropertyOptional({
    description: 'Filter by document type (e.g. "bal_sheet")',
    example: 'bal_sheet',
    enum: DocumentType,
  })
  //   @IsString()
  @IsEnum(DocumentType)
  //   @IsOptional()
  docType: string;

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
