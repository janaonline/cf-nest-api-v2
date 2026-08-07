import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PTAX_FINAL_ACTION } from '../../../../../../schemas/xv-fc-ptax-review.schema';
import type { PtaxFinalAction } from '../../../../../../schemas/xv-fc-ptax-review.schema';

export class SubmitPtaxReviewDto {
  @ApiProperty({ enum: PTAX_FINAL_ACTION })
  @IsIn(PTAX_FINAL_ACTION)
  finalAction: PtaxFinalAction;
}
