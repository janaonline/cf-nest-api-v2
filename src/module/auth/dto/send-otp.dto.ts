import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ description: 'Email address, census code, or SB code of the user' })
  @IsString()
  @IsNotEmpty()
  identifier!: string;
}
