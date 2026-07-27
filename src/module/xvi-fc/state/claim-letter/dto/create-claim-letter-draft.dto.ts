import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ClaimLetterUlbSelectionDto } from './claim-letter-ulb-selection.dto';

export class CreateClaimLetterDraftDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ClaimLetterUlbSelectionDto)
  ulbSelections!: ClaimLetterUlbSelectionDto[];

  // Client-suppliable idempotency key (plan §10) — a fresh one is generated server-side when omitted.
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
