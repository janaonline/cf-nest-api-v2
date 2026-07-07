import { Equals, IsIn } from 'class-validator';

export class SubmitSectionDto {
  @IsIn(['auditedData', 'unauditedData'])
  section: 'auditedData' | 'unauditedData';

  @Equals(true, { message: 'You must accept the self-declaration before submitting.' })
  selfDeclared: boolean;
}
