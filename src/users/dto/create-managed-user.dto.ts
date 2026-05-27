import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsMongoId, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Role } from 'src/module/auth/enum/role.enum';

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

  @ApiProperty({ example: 'kinjal@ulb.gov.in' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value.toLowerCase().trim())
  email!: string;

  @ApiProperty({ example: '8200677025' })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'mobile must be a 10-digit number' })
  mobile!: string;

  @ApiProperty({ enum: Object.values(Role) })
  @IsIn(Object.values(Role))
  role!: Role;

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
