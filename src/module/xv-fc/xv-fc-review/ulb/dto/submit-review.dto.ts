import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { XV_FC_FINAL_ACTION } from '../../../../../schemas/ledger-log.schema';
import type { XvFcFinalAction } from '../../../../../schemas/ledger-log.schema';

export class SubmitReviewDto {
  @ApiProperty({ enum: XV_FC_FINAL_ACTION })
  @IsIn(XV_FC_FINAL_ACTION)
  finalAction: XvFcFinalAction;
}
