import { Type } from 'class-transformer';
import {
  IsBoolean,
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

class EulbFileRefDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @IsOptional()
  @IsNumber()
  fileSize!: number | null;

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

class FinalSubmitEulbDataDto {
  @IsOptional()
  @IsNumber()
  ulbCount?: number;

  @IsObject()
  @ValidateNested()
  @Type(() => EulbFileRefDto)
  electedBodyExcelFile!: EulbFileRefDto;

  @IsBoolean()
  checkboxConfirmation!: boolean;
}

export class FinalSubmitElectedUrbanLocalBodiesDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => FinalSubmitEulbDataDto)
  data!: FinalSubmitEulbDataDto;
}
