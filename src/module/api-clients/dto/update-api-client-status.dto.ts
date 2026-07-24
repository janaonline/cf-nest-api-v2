import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const ALLOWED_STATUSES = ['ACTIVE', 'INACTIVE', 'REVOKED'] as const;

export class UpdateApiClientStatusDto {
  @ApiProperty({ enum: ALLOWED_STATUSES, description: 'New client status' })
  @IsIn(ALLOWED_STATUSES)
  status!: 'ACTIVE' | 'INACTIVE' | 'REVOKED';

  @ApiPropertyOptional({ description: 'Reason for status change (recommended for REVOKED)', maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
