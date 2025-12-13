import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export interface DigitizationJobData {
  annualAccountsId: string;
  ulb: string;
  year: string;
  auditType: string;
  docType: string;
  fileUrl: string; // S3/HTTP URL, or internal path
  digitizedExcelUrl?: string; // S3/HTTP URL, or internal path
  uploadedBy: 'ULB' | 'AFS';
}

export interface DigitizationJobResult {
  jobId: string;
}

export class DigitizationJobDataDto {
  @ApiProperty({
    description: 'Annual Accounts identifier',
    example: '630085be29ef916762354bdc',
  })
  @IsString()
  @IsNotEmpty()
  annualAccountsId: string;

  @ApiProperty({
    description: 'ULB identifier',
    example: '5dd24729437ba31f7eb42f46',
  })
  @IsString()
  @IsNotEmpty()
  ulb: string;

  @ApiProperty({
    description: 'Financial year for which the document is being digitized',
    example: '606aadac4dff55e6c075c507',
  })
  @IsString()
  @IsNotEmpty()
  year: string;

  @ApiProperty({
    description: 'Audit type of the document',
    example: 'audited',
  })
  @IsString()
  @IsNotEmpty()
  auditType: string;

  @ApiProperty({
    description: 'Document type to be digitized',
    example: 'bal_sheet_schedules',
  })
  @IsString()
  @IsNotEmpty()
  docType: string;

  @ApiProperty({
    description: 'Public or internal URL of the PDF to digitize',
    example:
      'https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/objects/c908edc2-1b41-47e9-9a1e-62bc827d80c1.pdf',
  })
  @IsString()
  @IsNotEmpty()
  fileUrl: string; // S3/HTTP URL, or internal path

  @ApiProperty({
    description: 'Public or internal URL of the digitized Excel file (if already available)',
    example:
      'afs/5dd24729437ba31f7eb42f46_606aadac4dff55e6c075c507_audited_bal_sheet_schedules_9778ccc5-c775-4369-a3bb-244dfc8240f0.xlsx',
  })
  @IsString()
  @IsNotEmpty()
  digitizedExcelUrl?: string; // S3/HTTP URL, or internal path

  @ApiProperty({
    description: 'Source of this file (ULB main file or AFS attachment)',
    example: 'ULB',
  })
  @IsString()
  @IsNotEmpty()
  uploadedBy: 'ULB' | 'AFS';
}
