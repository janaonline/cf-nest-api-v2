import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class QueryAdcDto {
  @ApiPropertyOptional({ description: 'Limit to one state (ADMIN only; a State user is always scoped to their own).' })
  @IsOptional()
  @IsMongoId()
  stateId?: string;
}
