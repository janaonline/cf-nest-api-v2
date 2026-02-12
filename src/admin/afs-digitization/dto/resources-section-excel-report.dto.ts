// digitization-report-query.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { YearLabels } from 'src/core/constants/years';
import { AuditType, FileType } from 'src/schemas/afs/afs-excel-file.schema';

export class ResourcesSectionExcelReportDto {
  @ApiProperty({
    description: 'ULB _id',
    example: '5dd24729437ba31f7eb42f46',
  })
  @IsNotEmpty()
  @IsMongoId()
  ulbId: string;

  @ApiProperty({
    description: 'Year (e.g. audited.year)',
    example: '2020-21',
  })
  @IsNotEmpty()
  @IsString()
  @IsIn(YearLabels)
  year: string;

  @ApiPropertyOptional({
    description: 'Year _id (e.g. audited.year)',
    example: '606aadac4dff55e6c075c507',
  })
  @IsOptional()
  @IsMongoId()
  yearId?: string;

  @ApiProperty({
    description: 'Audit type (audited/ unAudited)',
    example: 'audited',
    enum: AuditType,
  })
  @IsNotEmpty()
  @IsEnum(AuditType)
  auditType: AuditType;

  @ApiProperty({
    description: 'File type (ulbFile/ afsFile)',
    example: 'ulbFile',
    enum: FileType,
  })
  @IsNotEmpty()
  @IsEnum(FileType)
  fileType: FileType;
}
