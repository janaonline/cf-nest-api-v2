import { IsString, MinLength, Matches } from 'class-validator';

export class SetNewPasswordDto {
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!])/, {
    message: 'Password must include uppercase, lowercase, a number, and a special character (@#$%^&*!)',
  })
  newPassword!: string;

  @IsString()
  saveToken!: string;
}
