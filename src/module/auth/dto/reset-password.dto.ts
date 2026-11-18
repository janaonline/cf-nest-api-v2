import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsOtp } from '../decorators/is-otp.decorator';
import { Match } from 'src/common/decorators/match.decorator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../password-policy';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Email address, census code, SB code, or 10-digit mobile number used during sendOtp' })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiProperty({ description: 'OTP received via SMS / email' })
  @IsString()
  @IsOtp()
  otp!: string;

  @ApiProperty({
    minLength: 8,
    description: 'New password — must contain uppercase, lowercase, number and special character',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  newPassword!: string;

  @ApiProperty({ description: 'Must match newPassword' })
  @IsString()
  @Match('newPassword', { message: 'Passwords do not match' })
  confirmPassword!: string;
}
