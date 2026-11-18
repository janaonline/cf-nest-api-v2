import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@cityfinance.in or ULB Census Code / SB Code / 10-digit mobile (16thFC only)' })
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => {
    const v = (value as string).trim();
    return v.includes('@') ? v.toLowerCase() : v;
  })
  identifier!: string;

  @ApiProperty({ example: 'admin@123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiPropertyOptional({ enum: ['15thFC', '16thFC', 'state-dashboard', 'XVIFC', 'fiscalRankings'] })
  @IsOptional()
  @IsString()
  type?: string;

  // TS-1262: the unified sign-in page's role picker. Not enforced against the account's real
  // role — LoginService.login() no longer checks it. It only tells the picker which ID-field
  // format to render (census code vs email); optional for backward compatibility with any client
  // still on the old per-portal login flow that never sent this.
  @ApiPropertyOptional({ enum: ['ULB', 'STATE', 'MOHUA', 'PARTNER', 'DOE'] })
  @IsOptional()
  @IsString()
  @IsIn(['ULB', 'STATE', 'MOHUA', 'PARTNER', 'DOE'])
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recaptchaToken?: string;
}
