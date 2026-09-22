import { IsIn } from 'class-validator';
import { RequiredNoteWhenReturned } from 'src/module/xvi-fc/common/dto/xvi-fc-decision-dto.validators';

export class DurDecisionDto {
  @IsIn(['APPROVED', 'RETURNED'])
  decision: 'APPROVED' | 'RETURNED';

  @RequiredNoteWhenReturned('a DUR form')
  note?: string;
}
