import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsOtp } from '../decorators/is-otp.decorator';

export class VerifyOtpDto {
  @ApiProperty({ description: 'Email address, census code, or SB code used during sendOtp' })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiProperty({ example: '1234', description: 'OTP (length controlled by OTP_DIGITS env, default 4)' })
  @IsString()
  @IsOtp()
  otp!: string;
}
