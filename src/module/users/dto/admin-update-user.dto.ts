import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from 'src/module/auth/enum/role.enum';
import type { AdminSubRole } from './create-user.dto';

/**
 * ADMIN-only user update — every field is optional (only what's sent gets changed). If `role` is
 * sent and differs from the user's current role, the service clears whichever of `state`/`ulb`
 * no longer applies to the new role, so a role change never leaves a stale scope field behind
 * (the exact bug class found in the MoHUA/STATE cross-role restore issue earlier).
 */
export class AdminUpdateUserDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() ? value.toLowerCase().trim() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Matches(/^[6-9]\d{9}$/, { message: 'mobile must be a valid 10-digit Indian mobile number' })
  mobile?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  designation?: string;

  @ApiProperty({ enum: Role, required: false })
  @IsOptional()
  @IsIn(Object.values(Role))
  role?: Role;

  @ApiProperty({ enum: ['ADMIN', 'EDITOR', 'VIEWER'], required: false })
  @IsOptional()
  @IsIn(['ADMIN', 'EDITOR', 'VIEWER'])
  subRole?: AdminSubRole;

  @ApiProperty({ required: false, description: 'Required when (new) role is a STATE-family role.' })
  @IsOptional()
  @IsMongoId()
  stateId?: string;

  @ApiProperty({ required: false, description: 'Required when (new) role is a ULB-family role.' })
  @IsOptional()
  @IsMongoId()
  ulbId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  departmentName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail({}, { message: 'departmentEmail must be a valid email address' })
  @MaxLength(254)
  departmentEmail?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Matches(/^[6-9]\d{9}$/, { message: 'departmentContactNumber must be a valid 10-digit Indian mobile number' })
  departmentContactNumber?: string;

  @ApiProperty({ required: false, description: 'Activate/deactivate the account (does not soft-delete it).' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
