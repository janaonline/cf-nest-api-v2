import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Query params for `GET :stateId/:yearId/list` — mirrors `QueryUlbDto`'s page/limit convention
 *  (`master/ulb/dto/query-ulb.dto.ts`). No search/status filter yet — not asked for; easy to add
 *  later without a breaking change. */
export class GetRequestExemptionListQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}
