import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateUlbTypeDto {
  @ApiProperty({ example: 'Cantonment Board', description: 'Display name for this ULB type' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: ['XVIFC'],
    description:
      'Grant cycle codes this ULB type is NOT eligible for (e.g. XVIFC). Free-form — no fixed enum, since ' +
      'a future grant cycle is a data change here, not a code change. Matching the cycle code is ' +
      'case-sensitive and exact, so keep it consistent with whatever the consuming feature passes to ' +
      "`UlbEligibilityService`'s methods (currently just `'XVIFC'`).",
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  ineligibleForGrantCycles?: string[];
}
