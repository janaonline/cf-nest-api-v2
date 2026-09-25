import { IsIn } from 'class-validator';
import { RequiredNoteWhenReturned } from 'src/module/xvi-fc/common/dto/xvi-fc-decision-dto.validators';

export class BankAccountDecisionDto {
  @IsIn(['APPROVED', 'RETURNED'])
  decision: 'APPROVED' | 'RETURNED';

  @RequiredNoteWhenReturned('a bank account form')
  note?: string;
}
