import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
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
}

class SaveEulbDraftDataDto {
  @IsOptional()
  @IsNumber()
  ulbCount?: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EulbFileRefDto)
  electedBodyExcelFile?: EulbFileRefDto;

  @IsOptional()
  @IsBoolean()
  checkboxConfirmation?: boolean;
}

export class SaveElectedUrbanLocalBodiesDraftDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => SaveEulbDraftDataDto)
  data!: SaveEulbDraftDataDto;
}
