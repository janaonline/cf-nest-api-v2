import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Match } from 'src/common/decorators/match.decorator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../password-policy';

export class RegisterDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value.toLowerCase().trim())
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  password!: string;

  @ApiProperty()
  @IsString()
  @Match('password', { message: 'Passwords do not match' })
  confirmPassword!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recaptchaToken?: string;
}
