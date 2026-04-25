import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';
import { IsOtp } from '../decorators/is-otp.decorator';
import { Match } from 'src/common/decorators/match.decorator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Email address, census code, or SB code used during sendOtp' })
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
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'Password must have uppercase, lowercase, number and special character',
  })
  newPassword!: string;

  @ApiProperty({ description: 'Must match newPassword' })
  @IsString()
  @Match('newPassword', { message: 'Passwords do not match' })
  confirmPassword!: string;
}
