import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsMongoId, IsObject, IsOptional, IsString, ValidateIf } from 'class-validator';

export class SendTemplateEmailDto {
  @ApiProperty({
    example: ['user@example.com', 'user2@example.com'],
    description: 'One or more recipient email addresses',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  @Transform(({ value }: { value: unknown }) => (Array.isArray(value) ? value : [value]))
  @IsEmail({}, { each: true })
  to!: string[];

  @ApiPropertyOptional({
    example: '665abc123def456789012345',
    description: 'Fetch subject + body from a stored template. Overrides manual subject/body.',
  })
  @IsOptional()
  @IsMongoId()
  templateId?: string;

  @ApiPropertyOptional({
    example: 'pending-review',
    description: 'Fetch template by slug instead of ID.',
  })
  @IsOptional()
  @IsString()
  templateSlug?: string;

  @ApiPropertyOptional({
    example: 'Your submission is pending review',
    description: 'Used when no templateId/templateSlug is provided.',
  })
  @ValidateIf((o: SendTemplateEmailDto) => !o.templateId && !o.templateSlug)
  @IsString()
  subject?: string;

  @ApiPropertyOptional({
    example: '<p>Dear User, your submission is pending.</p>',
    description: 'HTML body used when no templateId/templateSlug is provided.',
  })
  @ValidateIf((o: SendTemplateEmailDto) => !o.templateId && !o.templateSlug)
  @IsString()
  body?: string;

  @ApiPropertyOptional({
    example: { name: 'Ramesh', fy: '2026-27', deadline: '30 June 2026' },
    description: 'Key-value pairs to replace {{variable}} placeholders in the template.',
  })
  @IsOptional()
  @IsObject()
  @Transform(({ value }: { value: unknown }) => (value && typeof value === 'object' ? value : undefined))
  variables?: Record<string, string>;
}
