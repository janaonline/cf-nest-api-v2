import { IsInt, IsMongoId, IsOptional, Min } from 'class-validator';

export class ClaimLetterUlbSelectionDto {
  @IsMongoId()
  ulbId!: string;

  // Whole Rupees. Required only while formjson 26 `meta.claimAmountEditable` is on; otherwise the
  // server stores the allocation and rejects a different value (resolveClaimedAmount).
  @IsOptional()
  @IsInt()
  @Min(1)
  claimedAmount?: number;
}
