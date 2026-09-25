import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Fields shared by every XVI-FC "state's paginated ULB submissions list" query — identical
 * across Annual Accounts and Bank Account today. Each form's own query DTO extends this and
 * adds whatever is specific to it (Annual Accounts' `section`, each form's own `status` value
 * type — string statuses for Annual Accounts, numeric FORM_STATUS values for Bank Account).
 */
export class UlbSubmissionsQueryBaseDto {
  @IsMongoId()
  designYearId: string;

  // ADMIN only — STATE users are always scoped to their own state, this is ignored for them.
  @IsOptional()
  @IsMongoId()
  stateId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['ulbName', 'formStatus'])
  sortField?: 'ulbName' | 'formStatus';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
