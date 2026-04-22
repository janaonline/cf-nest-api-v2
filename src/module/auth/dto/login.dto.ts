import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@cityfinance.in or ULB Census Code / SB Code' })
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => {
    const v = (value as string).trim();
    return v.includes('@') ? v.toLowerCase() : v;
  })
  email: string;

  @ApiProperty({ example: 'admin@123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recaptchaToken?: string;
}
