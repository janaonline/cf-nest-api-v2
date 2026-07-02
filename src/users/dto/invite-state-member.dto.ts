import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export type StateSubRoleDisplay = 'EDITOR' | 'VIEWER';

export class InviteStateMemberDto {
  @ApiProperty({ example: 'Priya Sharma' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'priya.sharma@assam.gov.in' })
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
    description: 'EDITOR maps to reviewer subrole; VIEWER maps to viewer subrole. Admin (submitter) cannot be assigned during invite.',
  })
  @IsIn(['EDITOR', 'VIEWER'], { message: 'subRole must be EDITOR or VIEWER' })
  subRole!: StateSubRoleDisplay;

  @ApiProperty({
    enum: ['invite', 'restore', 'force-new'],
    required: false,
    description: 'invite (default) — normal flow; restore — reactivate soft-deleted user; force-new — tombstone deleted records and create fresh',
  })
  @IsOptional()
  @IsIn(['invite', 'restore', 'force-new'])
  action?: 'invite' | 'restore' | 'force-new';
}
