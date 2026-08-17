import { IsIn } from 'class-validator';
import { RequiredNoteWhenReturned } from 'src/module/xvi-fc/common/dto/xvi-fc-decision-dto.validators';

export class ManualReviewDecisionDto {
  @IsIn(['APPROVED', 'RETURNED'])
  decision: 'APPROVED' | 'RETURNED';

  @RequiredNoteWhenReturned('a document')
  note?: string;
}
