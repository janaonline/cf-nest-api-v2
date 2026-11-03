import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import {
  MOHUA_CLAIM_LETTER_REMARK_MAX_LENGTH,
  MOHUA_CLAIM_LETTER_RETURNABLE_STATE_FORM_IDS,
} from './mohua-claim-letters.constants';

/** The letter-level return. Each ULB's forms and remark come from its saved SO decision, not from this body. */
export class ReturnMohuaClaimLetterDto {
  /** The `revision` the page showed; a claim letter changed since then is refused rather than returned blind. */
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  /** State-wide items: the claim letter (26), SFC (22), GTC (35). */
  @IsArray()
  @ArrayUnique()
  @IsIn(MOHUA_CLAIM_LETTER_RETURNABLE_STATE_FORM_IDS, { each: true })
  stateFormIds!: number[];

  @IsOptional()
  @IsString()
  @MaxLength(MOHUA_CLAIM_LETTER_REMARK_MAX_LENGTH)
  stateRemark?: string;
}
