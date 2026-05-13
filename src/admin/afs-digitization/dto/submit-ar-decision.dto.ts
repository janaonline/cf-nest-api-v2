import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

export class SubmitARDecisionDto {
  @ApiProperty({
    description: "Auditor's Report item identifier",
    example: '65a7dd50b0c7e600128b1234',
  })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({
    description: "Section of the Auditor's Report item",
    example: 'ocr_extraction',
    enum: ['ocr_extraction', 'classification', 'audit', 'summary'],
  })
  @IsEnum(['ocr_extraction', 'classification', 'audit', 'summary'])
  section!: 'ocr_extraction' | 'classification' | 'audit' | 'summary';

  @ApiProperty({
    description: "Decision on the Auditor's Report item",
    example: 'approved',
    enum: ['approved', 'rejected'],
  })
  @IsEnum(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @ApiPropertyOptional({
    description: 'Optional remarks for the decision',
    example: 'The report is acceptable with minor issues.',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Optional type for the decision',
    enum: ['ULB', 'AFS'],
  })
  @IsOptional()
  @IsEnum(['ULB', 'AFS'])
  type?: 'ULB' | 'AFS';
}
