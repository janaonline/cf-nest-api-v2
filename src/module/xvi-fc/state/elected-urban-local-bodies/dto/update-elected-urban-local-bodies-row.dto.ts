import { IsOptional } from 'class-validator';

// censusCode/ulbName are intentionally not editable here — every row is registry-backed, and
// identity fields belong to the ULB registry, not to a row-level portal edit.
export class UpdateElectedUrbanLocalBodiesRowDto {
  @IsOptional()
  electedBodyStatus?: string;

  @IsOptional()
  dateOfConstitution?: string;

  @IsOptional()
  dateOfExpiry?: string;

  @IsOptional()
  remarks?: string;
}
