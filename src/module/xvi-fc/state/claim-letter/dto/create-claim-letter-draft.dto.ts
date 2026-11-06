import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CLAIM_LETTER_MAX_ULBS } from '../constants/claim-letter.constants';
import { ClaimLetterUlbSelectionDto } from './claim-letter-ulb-selection.dto';

export class CreateClaimLetterDraftDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CLAIM_LETTER_MAX_ULBS)
  @ValidateNested({ each: true })
  @Type(() => ClaimLetterUlbSelectionDto)
  ulbSelections!: ClaimLetterUlbSelectionDto[];

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
