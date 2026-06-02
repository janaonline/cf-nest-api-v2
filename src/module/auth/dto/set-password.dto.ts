import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';
import { Match } from 'src/common/decorators/match.decorator';

export class SetPasswordDto {
  @ApiProperty({ description: 'Email, mobile number, or census/SB code' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: string }) => value.trim())
  identifier!: string;

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
