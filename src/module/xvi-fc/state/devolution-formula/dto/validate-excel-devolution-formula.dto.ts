import { Type } from 'class-transformer';
import { IsIn, IsMongoId, IsNotEmpty, IsObject, ValidateNested } from 'class-validator';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';
import { DF_INSTALLMENTS, type DfInstallment } from '../constants/devolution-formula.constants';

export class ValidateExcelDevolutionFormulaDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsIn(DF_INSTALLMENTS)
  installment!: DfInstallment;

  @IsObject()
  @ValidateNested()
  @Type(() => XviFcFileRefDto)
  excelFile!: XviFcFileRefDto;
}
