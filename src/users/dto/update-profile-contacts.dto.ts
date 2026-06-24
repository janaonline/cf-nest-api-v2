import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateProfileContactsDto {
  @ApiPropertyOptional({ example: 'Tusharbhai R Zalariya' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'np_mmiyana@yahoo.co.in' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '9824052506' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'mobile must be a 10-digit number' })
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
  @Matches(/^\d{6,15}$/, { message: 'departmentContactNumber must contain 6 to 15 digits' })
  departmentContactNumber?: string;

  @ApiPropertyOptional({ example: 'finance@ulb.gov.in' })
  @IsOptional()
  @IsEmail()
  departmentEmail?: string;

  @ApiPropertyOptional({ example: 'Ramesh Kumar' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  commissionerName?: string;

  @ApiPropertyOptional({ example: 'commissioner@ulb.gov.in' })
  @IsOptional()
  @IsEmail()
  commissionerEmail?: string;

  @ApiPropertyOptional({ example: '9123456780' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6,15}$/, { message: 'commissionerConatactNumber must contain 6 to 15 digits' })
  commissionerConatactNumber?: string;

  @ApiPropertyOptional({ example: 'Suresh Patel' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountantName?: string;

  @ApiPropertyOptional({ example: 'accounts@ulb.gov.in' })
  @IsOptional()
  @IsEmail()
  accountantEmail?: string;

  @ApiPropertyOptional({ example: '9000001111' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6,15}$/, { message: 'accountantConatactNumber must contain 6 to 15 digits' })
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
}
