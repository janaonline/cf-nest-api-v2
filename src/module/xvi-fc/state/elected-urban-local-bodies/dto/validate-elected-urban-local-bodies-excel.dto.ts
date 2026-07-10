import { Type } from 'class-transformer';
import {
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

class EulbValidateFileRefDto {
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

export class ValidateElectedUrbanLocalBodiesExcelDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsOptional()
  @IsNumber()
  ulbCount?: number;

  @IsObject()
  @ValidateNested()
  @Type(() => EulbValidateFileRefDto)
  electedBodyExcelFile!: EulbValidateFileRefDto;
}
