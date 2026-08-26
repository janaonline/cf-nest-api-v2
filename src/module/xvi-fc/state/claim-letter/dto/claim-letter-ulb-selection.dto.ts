import { IsInt, IsMongoId, Min } from 'class-validator';

export class ClaimLetterUlbSelectionDto {
  @IsMongoId()
  ulbId!: string;

  // Whole Rupees only — matches allocatedAmount's unit.
  // Server-authoritative ±10% variance check happens in ClaimLetterAssemblyService
  // — this only guards against a non-positive/sub-₹1 amount.
  @IsInt()
  @Min(1)
  claimedAmount!: number;
}
