import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({
    description: 'Email address, census code, or SB code of the account',
    example: 'admin@cityfinance.in',
  })
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => {
    const v = (value as string).trim();
    return v.includes('@') ? v.toLowerCase() : v;
  })
  identifier!: string;

  @ApiPropertyOptional({
    description: 'Purpose of the OTP — controls the Redis key namespace',
    enum: ['login'],
    default: 'login',
  })
  @IsOptional()
  @IsString()
  @IsIn(['login'])
  purpose?: string;
}
