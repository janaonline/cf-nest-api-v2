import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumber, IsString, Max, Min } from 'class-validator';
import { DECLARATION_TARGET_CODE, SUPPORTING_DOCUMENT_TARGET_CODE } from '../../../common/xv-fc-review.constants';

const UPLOAD_TARGET_CODES = [DECLARATION_TARGET_CODE, SUPPORTING_DOCUMENT_TARGET_CODE] as const;

export class PresignPtaxUploadDto {
  @ApiProperty({
    enum: UPLOAD_TARGET_CODES,
    description: 'There is no per-metric upload — one declaration and one shared supporting document per submission',
  })
  @IsString()
  @IsIn(UPLOAD_TARGET_CODES)
  targetCode: string;

  @ApiProperty({ example: 'supporting-doc.pdf' })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ example: 2_500_000, description: 'File size in bytes, max 20MB' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20 * 1024 * 1024)
  fileSize: number;
}
