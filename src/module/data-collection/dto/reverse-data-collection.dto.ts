import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ReverseDataCollectionDto {
  @ApiProperty({ description: 'Public ULB code (censusCode or sbCode)' })
  @IsString()
  @IsNotEmpty()
  ulbCode!: string;

  @ApiProperty({ description: 'Financial year code (e.g., 2021-22)' })
  @IsString()
  @IsNotEmpty()
  yearCode!: string;

  @ApiPropertyOptional({ description: 'Template version of the submission to reverse.' })
  @IsString()
  @IsOptional()
  templateVersion?: string;

  @ApiProperty({ description: 'Reason for reversing the submission.', minLength: 3, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
