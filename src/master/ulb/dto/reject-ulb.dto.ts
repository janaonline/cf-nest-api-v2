import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectUlbDto {
  @ApiProperty({ description: 'Reason the ULB submission is being rejected', example: 'Duplicate ULB code.' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  reason: string;
}
