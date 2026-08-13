import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsIn, IsMongoId, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { ActorType } from '../entities/api-client.schema';

const ALLOWED_ACTOR_TYPES = ['STATE', 'ULB'] as const;

export class CreateApiClientDto {
  @ApiPropertyOptional({ description: 'Human-readable label for this client', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @ApiProperty({ enum: ALLOWED_ACTOR_TYPES, description: 'Actor type determines ownership scope' })
  @IsIn(ALLOWED_ACTOR_TYPES)
  actorType!: ActorType;

  @ApiProperty({ description: 'MongoDB ObjectId of the owning state' })
  @IsMongoId()
  stateId!: string;

  @ApiPropertyOptional({ description: 'Required when actorType is ULB' })
  @IsMongoId()
  @IsOptional()
  ulbId?: string;

  @ApiProperty({ type: [String], description: 'Data-collection scopes to grant' })
  @IsArray()
  @IsString({ each: true })
  @ArrayNotEmpty()
  scopes!: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Allowed IP addresses. Empty list allows any IP.',
    example: ['192.168.1.1', '::1'],
  })
  @IsArray()
  @IsOptional()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/, {
    each: true,
    message: 'Each entry in allowedIps must be a valid IPv4 or IPv6 address',
  })
  allowedIps?: string[];
}
