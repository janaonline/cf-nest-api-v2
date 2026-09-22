import { IsIn, IsMongoId, IsNotEmpty, IsNumber, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DUR_DOC_IDS, type XviFcDurDocId } from 'src/schemas/xvi-fc/dur.schema';

export class ConfirmDurUploadDto {
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

  @IsIn(DUR_DOC_IDS)
  docId: XviFcDurDocId;

  @IsString()
  @IsNotEmpty()
  financialYear: string;

  @IsString()
  @IsNotEmpty()
  originalName: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20 * 1024 * 1024)
  fileSize: number;
}
