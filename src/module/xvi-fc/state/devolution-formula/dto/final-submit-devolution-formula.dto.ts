import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { DF_INSTALLMENTS, type DfInstallment } from '../constants/devolution-formula.constants';

class DfFileRefDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @IsOptional()
  @IsNumber()
  fileSize?: number | null;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  s3Key?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  pageCount?: number | null;
}

class DfFinalSubmitDataDto {
  @IsObject()
  @ValidateNested()
  @Type(() => DfFileRefDto)
  excelFile!: DfFileRefDto;

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
