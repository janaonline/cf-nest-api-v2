import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';

export class RequestExemptionDataDto {
  /** Which branch of the form this submission is — see CLAUDE.md's "exemptionFor branching"
   *  section. Optional, defaulting to `'ULB'` in `RequestExemptionService.validateAndSanitize` when
   *  absent, so the backend can deploy before `formjsons`/the frontend send this field. */
  @IsOptional()
  @IsIn(['ULB', 'STATE'])
  exemptionFor?: 'ULB' | 'STATE';

  /** An unanswered `select`/text control can round-trip as `''`, not `undefined` — @IsOptional()
   *  only skips validation for `undefined`, so an empty string would otherwise fail @IsMongoId().
   *  Normalize blank to undefined before validating. (Ignored on the `'STATE'` branch — see
   *  CLAUDE.md's "exemptionFor branching" section.) */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @IsMongoId()
  ulb?: string | null;

  /** The multi-select's option ids are strings (e.g. '23') — coerce each to a number before
   *  validating, so the payload matches `data[].formId: number` on the schema/allow-list. Only
   *  meaningful for the `'ULB'` branch — see `reasonForExemptionState` for `'STATE'`. */
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => Number(v)) : value))
  @IsArray()
  @IsInt({ each: true })
  reasonForExemption?: number[];

  /** The whole-state-branch equivalent of `reasonForExemption` — a separate field/key rather than
   *  reusing `reasonForExemption` with a different allow-list, since the frontend form renders
   *  them as two distinct fields (no mechanism there for one field's options to change based on
   *  another field's value). */
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => Number(v)) : value))
  @IsArray()
  @IsInt({ each: true })
  reasonForExemptionState?: number[];

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
