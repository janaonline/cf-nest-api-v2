import { IsIn } from 'class-validator';
import { RequiredNoteWhenReturned } from 'src/module/xvi-fc/common/dto/xvi-fc-decision-dto.validators';

export class SectionDecisionDto {
  @IsIn(['auditedData', 'unauditedData'])
  section: 'auditedData' | 'unauditedData';

  @IsIn(['APPROVED', 'RETURNED'])
  decision: 'APPROVED' | 'RETURNED';

  @RequiredNoteWhenReturned('a section')
  note?: string;
}
