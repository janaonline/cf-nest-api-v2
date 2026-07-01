import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { DF_INSTALLMENTS, type DfInstallment } from '../constants/devolution-formula.constants';

export class DumpDevolutionFormulaQueryDto {
  @IsOptional()
  @IsMongoId()
  stateId?: string;

  @IsOptional()
  @IsMongoId()
  yearId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn(DF_INSTALLMENTS)
  installment?: DfInstallment;

  @IsOptional()
  @IsIn(['NOT_VALIDATED', 'VALID', 'INVALID'])
  validationStatus?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;
}
