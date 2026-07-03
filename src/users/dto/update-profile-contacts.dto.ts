import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileContactsDto {
  @ApiPropertyOptional({ example: 'Tusharbhai R Zalariya' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'np_mmiyana@yahoo.co.in' })
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '9824052506' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  mobile?: string;

  @ApiPropertyOptional({ example: 'john_doe' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  username?: string;

  @ApiPropertyOptional({ example: 'Director, Urban Development' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  designation?: string;

  @ApiPropertyOptional({ example: 'Ministry of Urban Affairs' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  organization?: string;

  @ApiPropertyOptional({ example: '123, MG Road, Bengaluru' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional({ example: 'Finance Department' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  departmentName?: string;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  departmentContactNumber?: string;

  @ApiPropertyOptional({ example: 'finance@ulb.gov.in' })
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsEmail()
  departmentEmail?: string;

  @ApiPropertyOptional({ example: 'Ramesh Kumar' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  commissionerName?: string;

  @ApiPropertyOptional({ example: 'commissioner@ulb.gov.in' })
  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsEmail()
  commissionerEmail?: string | null;

  @ApiPropertyOptional({ example: '9123456780' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  commissionerConatactNumber?: string;

  @ApiPropertyOptional({ example: 'Suresh Patel' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountantName?: string;

  @ApiPropertyOptional({ example: 'accounts@ulb.gov.in' })
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsEmail()
  accountantEmail?: string;

  @ApiPropertyOptional({ example: '9000001111' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  accountantConatactNumber?: string;

  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'NA'] })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'NA'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isNodalOfficer?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isXVIFCProfileVerified?: boolean;

  @ApiPropertyOptional({ description: 'Mark false when a MoHUA user verifies their profile to un-flag any soft-removal' })
  @IsOptional()
  @Transform(({ value }) => value === false || value === 'false' ? false : value === true || value === 'true' ? true : undefined)
  @IsBoolean()
  isXviFcdeleted?: boolean;

  @ApiPropertyOptional({ description: 'One-time save token issued after OTP verification — required for state/MoHUA self-updates' })
  @IsOptional()
  @IsString()
  saveToken?: string;
}
