import { IsInt, IsMongoId, Min } from 'class-validator';

/** Yes-branch row input — whitelisted to exactly {ulbId, unspentAmount, previousFcUnspentBalance}, matching the frontend contract. */
export class FcUnspentUlbRowInputDto {
  @IsMongoId()
  ulbId!: string;

  // Whole Rupees only — no decimals, matching every other xvi-fc amount field. See
  // FcUnspentAllocationSource/XviFcUnspentStateFormRow.
  @IsInt()
  @Min(1)
  unspentAmount!: number;

  // Same whole-Rupee enforcement as unspentAmount, and likewise purely informational —
  // never participates in allocationPerc/eligibility computation.
  @IsInt()
  @Min(1)
  previousFcUnspentBalance!: number;
}
