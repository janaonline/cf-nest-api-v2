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

  // Optimistic-concurrency guard (plan §7.5/§10) — must match the draft's current `revision`.
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}
