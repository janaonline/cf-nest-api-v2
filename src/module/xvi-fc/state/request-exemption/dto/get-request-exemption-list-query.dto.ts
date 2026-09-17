import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';

/** The only 3 statuses a Request Exemption entry ever reaches - see `finalSubmit`'s own doc-comment. */
const REQUEST_EXEMPTION_STATUS_FILTER_VALUES = [
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.RETURNED_BY_MOHUA,
  FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
] as const;

/** Query params for `GET :stateId/:yearId/list` — mirrors `QueryUlbDto`'s page/limit convention
 *  (`master/ulb/dto/query-ulb.dto.ts`). `search`/`reasonForExemption`/`status` are applied in-memory
 *  in `RequestExemptionService.list()`, after the exemption docs are fetched and ULB info resolved,
 *  before pagination — same place `total`/`pages` are computed from, so filtered counts stay correct. */
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

  /** Case-insensitive substring match against the ULB's name and its already-resolved
   *  `censusCode` (which itself falls back to `sbCode`) — covers "ULB name/censusCode/sbCode". */
  @ApiPropertyOptional({ example: 'Agra' })
  @IsOptional()
  @IsString()
  search?: string;

  /** Not restricted to a fixed allow-list — the actual set of valid reasons is per-year data (see
   *  `RequestExemptionFormJsonConfigService.loadReasonOptions`), not something a class-validator
   *  decorator can check. A formId outside that year's real set simply matches nothing in
   *  `list()`'s in-memory filter, same as any other filter value that matches no rows. */
  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  reasonForExemption?: number;

  @ApiPropertyOptional({ example: 5, enum: REQUEST_EXEMPTION_STATUS_FILTER_VALUES })
  @IsOptional()
  @Type(() => Number)
  @IsIn(REQUEST_EXEMPTION_STATUS_FILTER_VALUES)
  status?: number;
}
