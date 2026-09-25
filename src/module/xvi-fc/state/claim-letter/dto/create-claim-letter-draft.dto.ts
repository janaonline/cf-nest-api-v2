import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ClaimLetterUlbSelectionDto } from './claim-letter-ulb-selection.dto';

export class CreateClaimLetterDraftDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ClaimLetterUlbSelectionDto)
  ulbSelections!: ClaimLetterUlbSelectionDto[];

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
