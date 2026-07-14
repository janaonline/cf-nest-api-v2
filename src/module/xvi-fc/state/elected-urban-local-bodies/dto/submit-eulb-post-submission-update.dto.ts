import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ELECTED_BODY_STATUSES } from 'src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';

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

export class SubmitEulbPostSubmissionUpdateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitEulbPostSubmissionUpdateRowDto)
  rows!: SubmitEulbPostSubmissionUpdateRowDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => XviFcFileRefDto)
  document!: XviFcFileRefDto;
}
