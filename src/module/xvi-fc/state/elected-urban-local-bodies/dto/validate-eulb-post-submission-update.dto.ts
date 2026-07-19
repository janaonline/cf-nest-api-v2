import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNotEmpty, IsMongoId, IsOptional, IsString, ValidateNested } from 'class-validator';

export class ValidateEulbPostSubmissionUpdateRowDto {
  @IsMongoId()
  @IsNotEmpty()
  rowId!: string;

  // Not `@IsIn([...])` — that list is DB-driven and class-validator decorators can't read it at
  // request-validation time. `@IsString()` catches malformed payloads; the real enum check runs
  // downstream in `ElectedUrbanLocalBodiesValidator` against the DB-loaded electedBodyStatus options.
  @IsString()
  @IsNotEmpty()
  electedBodyStatus!: string;

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
