import { IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../password-policy';

export class SetNewPasswordDto {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  newPassword!: string;

  @IsString()
  saveToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  mobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  designation?: string;
}
