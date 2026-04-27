import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
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

  @ApiPropertyOptional({ example: '+919980535453' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  mobileNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  departmentName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  departmentContactNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  departmentEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  commissionerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  commissionerEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  commissionerContactNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountantName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  accountantEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  accountantContactNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isXVIFCProfileVerified?: boolean;
}
