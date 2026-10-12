import { IsInt, IsMongoId, IsOptional, Min } from 'class-validator';

/**
 * Yes-branch row input allows only {ulbId, unspentAmount, previousFcUnspentBalance}.
 * Both amounts are optional for drafts, allowing ULB selections to be saved before entering values.
 * Any provided amount must be a whole number \>= 1. Both amounts are required only on final submission.
 */
export class FcUnspentUlbRowInputDto {
  @IsMongoId()
  ulbId!: string;

  // Whole Rupees only — no decimals, matching every other xvi-fc amount field. See
  // FcUnspentAllocationSource/XviFcUnspentStateFormRow.
  @IsOptional()
  @IsInt()
  @Min(1)
  unspentAmount?: number | null;

  // Same whole-Rupee enforcement as unspentAmount. Never participates in allocationPerc; under the
  // NO_UNSPENT_ALLOWED eligibility rule any balance here makes the ULB ineligible.
  @IsOptional()
  @IsInt()
  @Min(1)
  previousFcUnspentBalance?: number | null;
}
