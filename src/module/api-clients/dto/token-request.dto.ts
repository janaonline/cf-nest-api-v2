import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class TokenRequestDto {
  @ApiProperty({ description: 'API client ID', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  clientId!: string;

  @ApiProperty({ description: 'API client secret', maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  clientSecret!: string;
}
