import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ELECTED_BODY_STATUSES } from '../constants/elected-urban-local-bodies.constants';

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
