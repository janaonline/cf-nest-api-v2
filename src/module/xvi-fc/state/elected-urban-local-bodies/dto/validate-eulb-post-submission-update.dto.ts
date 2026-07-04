import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ELECTED_BODY_STATUSES } from 'src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants';

export class ValidateEulbPostSubmissionUpdateRowDto {
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

export class ValidateEulbPostSubmissionUpdateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ValidateEulbPostSubmissionUpdateRowDto)
  rows!: ValidateEulbPostSubmissionUpdateRowDto[];
}
