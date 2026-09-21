import { Transform, Type } from 'class-transformer';
import { IsArray, IsInt, IsMongoId, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';

export class RequestExemptionDataDto {
  /** An unanswered `select`/text control can round-trip as `''`, not `undefined` — @IsOptional()
   *  only skips validation for `undefined`, so an empty string would otherwise fail @IsMongoId()
   *  even on a draft. Normalize blank to undefined before validating. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @IsMongoId()
  ulb?: string | null;

  /** The multi-select's option ids are strings (e.g. '23') — coerce each to a number before
   *  validating, so the payload matches `data[].formId: number` on the schema/allow-list. Still
   *  named `reasonForExemption` here (what this one submission is asking for) even though the
   *  schema's own array field is named `data` — the DTO describes the request, the schema
   *  describes the stored per-formId entries; see `XviFcEligibilityExemption`'s doc-comment. */
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => Number(v)) : value))
  @IsArray()
  @IsInt({ each: true })
  reasonForExemption?: number[];

  @IsOptional()
  @IsString()
  supportingDetails?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => XviFcFileRefDto)
  supportingFile?: XviFcFileRefDto | null;
}

export class SaveRequestExemptionDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => RequestExemptionDataDto)
  data!: RequestExemptionDataDto;
}
