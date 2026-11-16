import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';
import {
  MOHUA_CLAIM_LETTER_REMARK_MAX_LENGTH,
  MOHUA_CLAIM_LETTER_REMARK_MIN_LENGTH,
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

  /** Why the letter is returned — required, shared with the State. Trimmed before the length checks. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(MOHUA_CLAIM_LETTER_REMARK_MIN_LENGTH, {
    message: `Remarks must be at least ${MOHUA_CLAIM_LETTER_REMARK_MIN_LENGTH} characters.`,
  })
  @MaxLength(MOHUA_CLAIM_LETTER_REMARK_MAX_LENGTH)
  stateRemark!: string;
}
