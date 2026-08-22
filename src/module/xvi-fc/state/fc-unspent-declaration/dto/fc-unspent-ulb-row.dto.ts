import { IsInt, IsMongoId, Min } from 'class-validator';

/** Yes-branch row input — whitelisted to exactly {ulbId, unspentAmount}, matching the frontend contract. */
export class FcUnspentUlbRowInputDto {
  @IsMongoId()
  ulbId!: string;

  // Whole Rupees only — no decimals, matching every other xvi-fc amount field. See
  // FcUnspentAllocationSource/XviFcUnspentStateFormRow.
  @IsInt()
  @Min(1)
  unspentAmount!: number;
}
