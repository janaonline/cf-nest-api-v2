import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export type MohuaSubRoleDisplay = 'EDITOR' | 'VIEWER';

export class InviteMohuaMemberDto {
  @ApiProperty({ example: 'Priya Sharma' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'priya.sharma@mohua.gov.in' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() ? value.toLowerCase().trim() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, { message: 'mobile must be a valid 10-digit Indian mobile number' })
  mobile!: string;

  @ApiProperty({ example: 'Deputy Secretary' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  designation!: string;

  @ApiProperty({
    enum: ['EDITOR', 'VIEWER'],
    description: 'EDITOR maps to reviewer subrole; VIEWER maps to viewer subrole. Submitter cannot be assigned during invite.',
  })
  @IsIn(['EDITOR', 'VIEWER'], { message: 'subRole must be EDITOR or VIEWER' })
  subRole!: MohuaSubRoleDisplay;

  @ApiProperty({
    enum: ['invite', 'restore', 'force-new'],
    required: false,
    description: 'invite (default) — normal flow; restore — reactivate soft-deleted user; force-new — create fresh account',
  })
  @IsOptional()
  @IsIn(['invite', 'restore', 'force-new'])
  action?: 'invite' | 'restore' | 'force-new';
}
