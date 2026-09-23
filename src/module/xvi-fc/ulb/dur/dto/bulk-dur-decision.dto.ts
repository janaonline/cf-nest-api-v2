import { IsIn } from 'class-validator';
import { BulkIdsList, RequiredNoteWhenReturned } from 'src/module/xvi-fc/common/dto/xvi-fc-decision-dto.validators';

export class BulkDurDecisionDto {
  @IsIn(['APPROVED', 'RETURNED'])
  decision: 'APPROVED' | 'RETURNED';

  @BulkIdsList()
  ids: string[];

  @RequiredNoteWhenReturned('a DUR form')
  note?: string;
}
