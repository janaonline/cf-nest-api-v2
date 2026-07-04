import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEmailTemplateDto {
  @ApiProperty({ example: 'Pending Review', description: 'Display name for this template' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    example: 'pending-review',
    description: 'URL-safe slug (auto-generated from name if omitted)',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: string }) =>
    value
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, ''),
  )
  slug?: string;

  @ApiProperty({ example: 'Your submission is pending review' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @ApiProperty({
    example: '<p>Dear {{name}},</p><p>Your submission is currently under review.</p>',
    description: 'HTML body. Use {{variableName}} for dynamic values.',
  })
  @IsString()
  @IsNotEmpty()
  body!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
