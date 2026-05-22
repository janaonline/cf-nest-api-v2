import { ArrayNotEmpty, IsArray, IsIn, IsNumber, IsString, ValidateIf } from 'class-validator';

export class LineItemRuleDto {
  @IsIn(['formula', 'comparison'])
  type!: 'formula' | 'comparison';

  @ValidateIf((o: { type: string }) => o.type === 'formula')
  @IsIn(['sum', 'diff'])
  operation?: 'sum' | 'diff';

  @ValidateIf((o: { type: string }) => o.type === 'formula')
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  operands?: string[];

  @ValidateIf((o: { type: string }) => o.type === 'comparison')
  @IsIn(['<=', '>=', '===', '<', '>'])
  operator?: '<=' | '>=' | '===' | '<' | '>';

  @ValidateIf((o: { type: string }) => o.type === 'comparison')
  @IsNumber()
  value?: number;
}
