import { IsIn, IsMongoId, IsNotEmpty, IsNumber, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ConfirmUploadDto {
  @IsUUID()
  uploadId: string;

  @IsString()
  @IsNotEmpty()
  s3Key: string;

  @IsMongoId()
  ulbId: string;

  @IsMongoId()
  stateId: string;

  @IsMongoId()
  designYearId: string;

  @IsIn(['auditedData', 'unauditedData'])
  section: string;

  @IsString()
  @IsNotEmpty()
  docId: string;

  @IsMongoId()
  yearId: string;

  @IsString()
  @IsNotEmpty()
  year: string;

  @IsString()
  @IsNotEmpty()
  originalName: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20 * 1024 * 1024)
  fileSize: number;
}
