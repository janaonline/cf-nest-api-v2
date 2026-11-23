import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsPolicyPassword } from '../password-policy';

export class SetNewPasswordDto {
  @IsPolicyPassword()
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
