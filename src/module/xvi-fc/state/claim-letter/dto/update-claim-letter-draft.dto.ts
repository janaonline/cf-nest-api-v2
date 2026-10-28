import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Min, ValidateNested } from 'class-validator';
import { ClaimLetterUlbSelectionDto } from './claim-letter-ulb-selection.dto';

export class UpdateClaimLetterDraftDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ClaimLetterUlbSelectionDto)
  ulbSelections!: ClaimLetterUlbSelectionDto[];

  // Must match the draft's revision; edits use this, not an idempotency key (ADR 0001).
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}
