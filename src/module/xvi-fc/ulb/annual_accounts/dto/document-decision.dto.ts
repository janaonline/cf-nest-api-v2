import { IsIn } from 'class-validator';
import { RequiredNoteWhenReturned } from 'src/module/xvi-fc/common/dto/xvi-fc-decision-dto.validators';

export class DocumentDecisionDto {
  @IsIn(['auditedData', 'unauditedData'])
  section: 'auditedData' | 'unauditedData';

  @IsIn(['APPROVED', 'RETURNED'])
  decision: 'APPROVED' | 'RETURNED';

  @RequiredNoteWhenReturned('a document')
  note?: string;
}
