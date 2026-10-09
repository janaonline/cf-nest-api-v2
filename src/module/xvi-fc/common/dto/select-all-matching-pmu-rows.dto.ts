import { IsOptional, IsString } from 'class-validator';

/** The same `search` filter `getRows()` applies — reused, not re-specified, so "select all
 *  matching" always means the same thing a reviewer sees on screen. No `rowStatus` field: a bulk
 *  approve/reject only ever targets rows already `UNDER_REVIEW_BY_PMU`, enforced server-side
 *  regardless of what the client sends. */
export class SelectAllMatchingPmuRowsDto {
  @IsOptional()
  @IsString()
  search?: string;
}
