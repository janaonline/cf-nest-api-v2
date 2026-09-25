import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RotateSecretDto {
  @ApiPropertyOptional({ description: 'Optional reason for this rotation', maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
