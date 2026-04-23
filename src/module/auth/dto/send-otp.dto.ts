import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ example: 'admin@cityfinance.in or ULB Census Code / SB Code' })
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => {
    const v = (value as string).trim();
    return v.includes('@') ? v.toLowerCase() : v;
  })
  email!: string;
}
