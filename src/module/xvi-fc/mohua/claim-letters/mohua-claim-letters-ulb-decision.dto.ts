import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  MOHUA_CLAIM_LETTER_REMARK_MAX_LENGTH,
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

  @IsOptional()
  @IsString()
  @MaxLength(MOHUA_CLAIM_LETTER_REMARK_MAX_LENGTH)
  remark?: string;
}
