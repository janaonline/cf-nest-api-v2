import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumber, IsString, IsUUID, Max, Min } from 'class-validator';
import {
  DECLARATION_TARGET_CODE,
  MAX_UPLOAD_SIZE_BYTES,
  SUPPORTING_DOCUMENT_TARGET_CODE,
} from '../../../common/xv-fc-review.constants';

const UPLOAD_TARGET_CODES = [DECLARATION_TARGET_CODE, SUPPORTING_DOCUMENT_TARGET_CODE] as const;

export class ConfirmPtaxUploadDto {
  @ApiProperty({ description: 'uploadId returned by the presign call' })
  @IsUUID()
  uploadId: string;

  @ApiProperty({ description: 's3Key returned by the presign call' })
  @IsString()
  @IsNotEmpty()
  s3Key: string;

  @ApiProperty({ enum: UPLOAD_TARGET_CODES })
  @IsString()
  @IsIn(UPLOAD_TARGET_CODES)
  targetCode: string;

  @ApiProperty({ example: 'supporting-doc.pdf' })
  @IsString()
  @IsNotEmpty()
  originalName: string;

  @ApiProperty({ example: 2_500_000, description: 'File size in bytes, max 20MB' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(MAX_UPLOAD_SIZE_BYTES)
  fileSize: number;
}
