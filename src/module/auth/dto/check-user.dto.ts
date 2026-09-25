import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CheckUserDto {
  @ApiProperty({ example: '9876543210', description: 'Mobile number, email, or census/ULB code' })
  @IsString()
  @IsNotEmpty({ message: 'Identifier is required.' })
  @Transform(({ value }: { value: string }) => value.trim())
  identifier!: string;

  @ApiPropertyOptional({ enum: ['ULB', 'STATE', 'MOHUA', 'DOE'] })
  @IsOptional()
  @IsString()
  role?: string;
}
