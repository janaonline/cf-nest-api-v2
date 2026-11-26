import { Transform } from 'class-transformer';
import { IsMongoId, IsNumber, IsOptional, IsPositive } from 'class-validator';

export class ClaimLetterUlbSelectionDto {
  @IsMongoId()
  ulbId!: string;

  // Switch (formjson 26 `meta.claimAmountEditable`) off: optional, and must equal the allocation, which may end in .50.
  // Switch on: required, whole Rupees within the band. Both are decided in resolveClaimedAmount.
  @Transform(({ value }) => (value === null ? undefined : (value as unknown)))
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  claimedAmount?: number;
}
