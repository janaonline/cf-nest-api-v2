import { IsMongoId, IsNumber, Min } from 'class-validator';

export class ClaimLetterUlbSelectionDto {
  @IsMongoId()
  ulbId!: string;

  // Server-authoritative ±10% variance check happens in ClaimLetterAssemblyService (plan §8) —
  // this only guards against a non-positive amount before it reaches business logic.
  @IsNumber()
  @Min(0.01)
  claimedAmount!: number;
}
