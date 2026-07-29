import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class GetDataCollectionDto {
  @ApiProperty({ description: 'ULB code (censusCode)', maxLength: 10, minLength: 1 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(10)
  ulbCode!: string;

  @ApiProperty({ description: 'Financial year code (e.g., 2024-25)', maxLength: 6, minLength: 6 })
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'yearCode must be in the format YYYY-YY (e.g., 2024-25)',
  })
  yearCode!: string;

  @ApiPropertyOptional({ description: 'Template version to filter by.', maxLength: 20 })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  templateVersion?: string;
}
