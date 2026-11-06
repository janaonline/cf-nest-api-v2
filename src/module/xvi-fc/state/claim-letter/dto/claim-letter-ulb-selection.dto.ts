import { Transform } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, Min } from 'class-validator';

export class ClaimLetterUlbSelectionDto {
  @IsMongoId()
  ulbId!: string;

  // Whole Rupees. Required only while formjson 26 `meta.claimAmountEditable` is on; otherwise the field is optional and will be ignored.
  @Transform(({ value }) => (value === null ? undefined : (value as unknown)))
  @IsOptional()
  @IsInt()
  @Min(1)
  claimedAmount?: number;
}
