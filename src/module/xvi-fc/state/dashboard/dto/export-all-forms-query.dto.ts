import { IsMongoId, IsOptional } from 'class-validator';

/** Query for the combined "every ULB × every form" CSV export — no pagination/sort/search, always
 *  the full unfiltered list (mirrors the old "Export all ULB submissions" scope, not the
 *  per-status one). */
export class ExportAllFormsQueryDto {
  @IsMongoId()
  designYearId!: string;

  // ADMIN only — STATE users are always scoped to their own state, this is ignored for them.
  @IsOptional()
  @IsMongoId()
  stateId?: string;
}
