import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import {
  MOHUA_CLAIM_LETTER_REMARK_MAX_LENGTH,
  MOHUA_CLAIM_LETTER_REMARK_MIN_LENGTH,
  MOHUA_CLAIM_LETTER_RETURNABLE_ROW_FORM_IDS,
  MOHUA_CLAIM_LETTER_RETURNABLE_ULB_FORM_IDS,
} from './mohua-claim-letters.constants';

/** The SO's return mark on one ULB of a letter under SO review. PENDING clears it. */
export class DecideMohuaClaimLetterUlbDto {
  @IsIn(['RETURNED', 'PENDING'])
  status!: 'RETURNED' | 'PENDING';

  /** RETURNED only: the ULB's own forms to reopen. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(MOHUA_CLAIM_LETTER_RETURNABLE_ULB_FORM_IDS, { each: true })
  ulbFormIds?: number[];

  /** RETURNED only: State forms whose row for this ULB is reopened. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(MOHUA_CLAIM_LETTER_RETURNABLE_ROW_FORM_IDS, { each: true })
  rowFormIds?: number[];

  /** RETURNED only, for an "Eligible via exemption" ULB: forms whose pending exemption the return rejects. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  rejectExemptionFormIds?: number[];

  /** RETURNED: why this ULB is returned — required, shared with the ULB and the State. Ignored for PENDING. */
  @ValidateIf((dto: DecideMohuaClaimLetterUlbDto) => dto.status === 'RETURNED')
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(MOHUA_CLAIM_LETTER_REMARK_MIN_LENGTH, {
    message: `Remarks must be at least ${MOHUA_CLAIM_LETTER_REMARK_MIN_LENGTH} characters.`,
  })
  @MaxLength(MOHUA_CLAIM_LETTER_REMARK_MAX_LENGTH)
  remark?: string;
}
