import { Type } from 'class-transformer';
import { IsMongoId, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';

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
