import { IsInt, IsMongoId, Min } from 'class-validator';

export class ClaimLetterUlbSelectionDto {
  @IsMongoId()
  ulbId!: string;

  // Whole Rupees; the variance band is checked in ClaimLetterAssemblyService.
  @IsInt()
  @Min(1)
  claimedAmount!: number;
}
