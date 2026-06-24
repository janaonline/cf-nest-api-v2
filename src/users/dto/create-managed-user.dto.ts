import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsMongoId, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { MANAGED_ROLES } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { ManagedRole } from 'src/module/auth/enum/roles-xvi-fc.enum';

export class CreateManagedUserDto {
  @ApiProperty({ example: 'Kinjal Banugariya' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'kinjal_b' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username!: string;

  @ApiPropertyOptional({ example: 'kinjal@ulb.gov.in' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() ? value.toLowerCase().trim() : undefined))
  @ValidateIf((o: CreateManagedUserDto) => !!o.email)
  @IsEmail()
  email?: string;

  @ApiProperty({ example: '8200677025' })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'mobile must be a 10-digit number' })
  mobile!: string;

  @ApiProperty({
    enum: MANAGED_ROLES,
    description:
      'Role to assign to the new user. Only managed (non-submitter) roles are accepted: ' +
      MANAGED_ROLES.join(', '),
  })
  @IsIn([...MANAGED_ROLES], {
    message: `role must be one of: ${MANAGED_ROLES.join(', ')}`,
  })
  role!: ManagedRole;

  @ApiPropertyOptional({ example: 'Accountant' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  designation?: string;

  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'NA'], default: 'PENDING' })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'NA'])
  status?: string;

  @ApiPropertyOptional()
  @Transform(({ value }: { value: unknown }) => value || undefined)
  @IsOptional()
  @IsMongoId()
  ulbId?: string;

  @ApiPropertyOptional()
  @Transform(({ value }: { value: unknown }) => value || undefined)
  @IsOptional()
  @IsMongoId()
  stateId?: string;
}
