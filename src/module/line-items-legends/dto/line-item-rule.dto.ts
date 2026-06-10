import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNumber,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'isFormulaOperands' })
class IsFormulaOperandsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (!Array.isArray(value)) return true;

    const obj = args.object as { operation?: string };

    if (obj.operation === 'linear') {
      return value.every((item) => {
        if (typeof item !== 'object' || item === null) return false;
        const operand = item as Record<string, unknown>;
        return (
          typeof operand.code === 'string' &&
          operand.code.trim().length > 0 &&
          (operand.sign === 1 || operand.sign === -1)
        );
      });
    }

    return value.every((item) => typeof item === 'string' && item.trim().length > 0);
  }

  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as { operation?: string };
    if (obj.operation === 'linear') {
      return `${args.property} must be an array of { code: string; sign: 1 | -1 } objects`;
    }
    return `${args.property} must be an array of non-empty strings`;
  }
}

export class LineItemRuleDto {
  @IsIn(['formula', 'comparison'])
  type!: 'formula' | 'comparison';

  @ValidateIf((o: { type: string }) => o.type === 'formula')
  @IsIn(['sum', 'diff', 'linear'])
  operation?: 'sum' | 'diff' | 'linear';

  @ValidateIf((o: { type: string }) => o.type === 'formula')
  @IsArray()
  @ArrayNotEmpty()
  @Validate(IsFormulaOperandsConstraint)
  operands?: string[] | { code: string; sign: 1 | -1 }[];

  @ValidateIf((o: { type: string }) => o.type === 'comparison')
  @IsIn(['<=', '>=', '===', '!==', '<', '>'])
  operator?: '<=' | '>=' | '===' | '!==' | '<' | '>';

  @ValidateIf((o: { type: string }) => o.type === 'comparison')
  @IsNumber()
  value?: number;
}
