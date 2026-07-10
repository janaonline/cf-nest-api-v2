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

class DfSaveDraftDataDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DfFileRefDto)
  excelFile?: DfFileRefDto;

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
