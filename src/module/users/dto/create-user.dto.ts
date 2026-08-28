import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from 'src/module/auth/enum/role.enum';

export type AdminSubRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

/**
 * ADMIN-only user creation — supports every Role, not just the STATE/MoHUA "invite a member of my
 * own team" flows (invite-state-member / invite-mohua-member), which remain unchanged and stay
 * scoped to inviting into the caller's own team. There is no `password` field on purpose: every
 * user-creation path in this codebase generates a random placeholder server-side (see
 * generatePlaceholderPassword) and activates the account via the Forgot Password OTP flow —
 * accepting a client-supplied password here would break that convention.
 */
export class CreateUserDto {
  @ApiProperty({ example: 'User 10' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'user10_16fc@cityfinance.in' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() ? value.toLowerCase().trim() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '8987654321' })
  @Matches(/^[6-9]\d{9}$/, { message: 'mobile must be a valid 10-digit Indian mobile number' })
  mobile!: string;

  @ApiProperty({ example: 'XVIFC_USER' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  designation!: string;

  @ApiProperty({ enum: Role, example: Role.XVIFC })
  @IsIn(Object.values(Role))
  role!: Role;

  @ApiProperty({
    enum: ['ADMIN', 'EDITOR', 'VIEWER'],
    required: false,
    description:
      "Only meaningful for STATE/ULB/MoHUA-family roles (validated against that role's own " +
      "vocabulary server-side). 'ADMIN' (Submitter) can only be set on the single account seeded " +
      'for that team — use the transfer-ownership endpoints to move it, never this one.',
  })
  @IsOptional()
  @IsIn(['ADMIN', 'EDITOR', 'VIEWER'])
  subRole?: AdminSubRole;

  @ApiProperty({ required: false, description: 'Required when role is a STATE-family role.' })
  @IsOptional()
  @IsMongoId()
  stateId?: string;

  @ApiProperty({ required: false, description: 'Required when role is a ULB-family role.' })
  @IsOptional()
  @IsMongoId()
  ulbId?: string;

  @ApiProperty({ required: false, example: 'Delhi' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiProperty({ required: false, example: '16th FC-User' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  departmentName?: string;

  @ApiProperty({ required: false, example: 'dept.contact@example.com' })
  @IsOptional()
  @IsEmail({}, { message: 'departmentEmail must be a valid email address' })
  @MaxLength(254)
  departmentEmail?: string;

  @ApiProperty({ required: false, example: '8987654322' })
  @IsOptional()
  @Matches(/^[6-9]\d{9}$/, { message: 'departmentContactNumber must be a valid 10-digit Indian mobile number' })
  departmentContactNumber?: string;

  @ApiProperty({
    required: false,
    description:
      "Marks this account as its team's Nodal Officer — drives xviFcSubrole derivation when a " +
      'STATE user later verifies their own profile (isNodalOfficer: true → admin, false → reviewer).',
  })
  @IsOptional()
  @IsBoolean()
  isNodalOfficer?: boolean;
}
