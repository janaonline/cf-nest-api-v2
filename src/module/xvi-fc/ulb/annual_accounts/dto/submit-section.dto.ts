import { IsIn } from 'class-validator';

export class SubmitSectionDto {
  @IsIn(['auditedData', 'unauditedData'])
  section: 'auditedData' | 'unauditedData';
}
