import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetUlbOptionsQueryDto {
  // Query params, not route params: the generic formjson-driven AutocompleteComponent that calls
  // this endpoint only ever hits a fixed URL string plus query params - it has no path-interpolation
  // mechanism, unlike Claim Letter's/FC Unspent's own bespoke ULB pickers.
  @ApiProperty({ example: '650f1a2b3c4d5e6f7a8b9c0d' })
  @IsMongoId()
  stateId!: string;

  @ApiProperty({ example: '650f1a2b3c4d5e6f7a8b9c0e' })
  @IsMongoId()
  yearId!: string;

  @ApiPropertyOptional({ example: 'Agra' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
