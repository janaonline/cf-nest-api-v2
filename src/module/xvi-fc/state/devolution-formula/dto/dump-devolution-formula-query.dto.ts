import { IsIn, IsMongoId, IsOptional } from 'class-validator';
import { DF_INSTALLMENTS, type DfInstallment } from '../constants/devolution-formula.constants';

export class DumpDevolutionFormulaQueryDto {
  @IsOptional()
  @IsMongoId()
  stateId?: string;

  @IsOptional()
  @IsMongoId()
  yearId?: string;

  @IsOptional()
  @IsIn(DF_INSTALLMENTS)
  installment?: DfInstallment;

  @IsOptional()
  @IsIn(['NOT_VALIDATED', 'VALID', 'INVALID'])
  validationStatus?: string;
}
