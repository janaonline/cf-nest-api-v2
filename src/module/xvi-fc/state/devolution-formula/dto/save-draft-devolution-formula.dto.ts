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

class DfSaveDraftDataDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => XviFcFileRefDto)
  excelFile?: XviFcFileRefDto;

  @IsOptional()
  @IsBoolean()
  checkboxConfirmation?: boolean;

  @IsOptional()
  @IsNumber()
  ulbCount?: number;
}

export class SaveDraftDevolutionFormulaDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsIn(DF_INSTALLMENTS)
  installment!: DfInstallment;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DfSaveDraftDataDto)
  data?: DfSaveDraftDataDto;
}
