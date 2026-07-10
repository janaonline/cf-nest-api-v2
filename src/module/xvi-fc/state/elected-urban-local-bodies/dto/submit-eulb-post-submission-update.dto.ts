import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ELECTED_BODY_STATUSES } from 'src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants';

export class SubmitEulbPostSubmissionUpdateRowDto {
  @IsMongoId()
  @IsNotEmpty()
  rowId!: string;

  @IsString()
  @IsIn(ELECTED_BODY_STATUSES)
  electedBodyStatus!: 'Constituted' | 'Not Constituted' | 'Exempt';

  @IsOptional()
  @IsString()
  dateOfConstitution?: string | null;

  @IsOptional()
  @IsString()
  dateOfExpiry?: string | null;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class EulbPostSubmissionUpdateDocumentDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @IsNumber()
  @IsPositive()
  fileSize!: number;

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

export class SubmitEulbPostSubmissionUpdateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitEulbPostSubmissionUpdateRowDto)
  rows!: SubmitEulbPostSubmissionUpdateRowDto[];

  @ValidateNested()
  @Type(() => EulbPostSubmissionUpdateDocumentDto)
  document!: EulbPostSubmissionUpdateDocumentDto;
}
