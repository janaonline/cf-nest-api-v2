import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';
import { DF_INSTALLMENTS, type DfInstallment } from '../constants/devolution-formula.constants';

class DfFinalSubmitDataDto {
  @IsObject()
  @ValidateNested()
  @Type(() => XviFcFileRefDto)
  excelFile!: XviFcFileRefDto;

  @IsBoolean()
  checkboxConfirmation!: boolean;

  @IsOptional()
  @IsNumber()
  ulbCount?: number;
}

export class FinalSubmitDevolutionFormulaDto {
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
  @Type(() => DfFinalSubmitDataDto)
  data!: DfFinalSubmitDataDto;
}
