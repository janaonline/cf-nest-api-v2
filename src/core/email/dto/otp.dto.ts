import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({
    example: 'jeevanantham.d@janaagraha.org',
    description: 'Email address to send OTP',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'jeevanantham.d@janaagraha.org', description: 'Email address used for OTP' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP received via email' })
  @IsNotEmpty()
  //   @IsNumber()
  otp: string;
}
