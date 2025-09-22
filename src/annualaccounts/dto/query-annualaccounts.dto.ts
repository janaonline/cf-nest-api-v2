import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class QueryAnnualAccountsDto {
  @ApiPropertyOptional({
    description: 'ULB ObjectId',
    example: '5dd006d4ffbcc50cfd92c87c',
  })
  @IsOptional()
  @IsString()
  ulb?: string;

  @ApiPropertyOptional({
    description: 'State ObjectId',
    example: '5dcf9d7316a06aed41c748ec',
  })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({
    description: 'ULB Type ObjectId',
    example: '5dcfa67543263a0e75c71697',
  })
  @IsOptional()
  @IsString()
  ulbType?: string;

  @ApiPropertyOptional({
    description: 'Population category',
    example: '500K-1M',
  })
  @IsOptional()
  @IsString()
  popCat?: string;

  @ApiPropertyOptional({
    description: 'Audit yearId',
    example: '606aaf854dff55e6c075d219',
  })
  @IsOptional()
  @IsString()
  year?: string;

  @ApiPropertyOptional({
    description: 'Audit Type must be audited or unaudited',
    example: 'audited',
  })
  @IsOptional()
  @IsString()
  auditType?: string;
}
