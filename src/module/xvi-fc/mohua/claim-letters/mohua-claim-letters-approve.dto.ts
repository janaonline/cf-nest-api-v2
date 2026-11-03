import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { MOHUA_CLAIM_LETTER_REMARK_MAX_LENGTH } from './mohua-claim-letters.constants';

export class ApproveMohuaClaimLetterDto {
  /** The `revision` the page showed; a claim letter edited since then is refused rather than approved blind. */
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsOptional()
  @IsString()
  @MaxLength(MOHUA_CLAIM_LETTER_REMARK_MAX_LENGTH)
  remark?: string;
}
