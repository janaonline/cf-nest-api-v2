import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const isInvite = (dto: SetAdcAdminDto) => dto.mode === 'invite';

/** `promote` an existing verified member (`userId`), or `invite` a new person (name, email, mobile, designation). */
export class SetAdcAdminDto {
  @ApiProperty({ enum: ['promote', 'invite'] })
  @IsIn(['promote', 'invite'])
  mode!: 'promote' | 'invite';

  @ApiPropertyOptional({ description: 'Required for promote' })
  @ValidateIf((dto: SetAdcAdminDto) => dto.mode === 'promote')
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({ description: 'Required for invite' })
  @ValidateIf(isInvite)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Required for invite' })
  @ValidateIf(isInvite)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() ? value.toLowerCase().trim() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ description: 'Required for invite' })
  @ValidateIf(isInvite)
  @Matches(/^[6-9]\d{9}$/, { message: 'mobile must be a valid 10-digit Indian mobile number' })
  mobile?: string;

  @ApiPropertyOptional({ description: 'Required for invite' })
  @ValidateIf(isInvite)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  designation?: string;

  @ApiPropertyOptional({ enum: ['invite', 'restore'], description: 'invite only: restore a removed member' })
  @IsOptional()
  @IsIn(['invite', 'restore'])
  action?: 'invite' | 'restore';
}
