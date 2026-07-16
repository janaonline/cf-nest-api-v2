import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsMongoId, IsNotEmpty, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';
import { FcUnspentUlbRowInputDto } from './fc-unspent-ulb-row.dto';

/**
 * `isFcUnspent` is intentionally `@IsBoolean()` only — no `@Transform`. The frontend's
 * current mock service sends the radio control's raw `'yes'|'no'` string; that is
 * rejected with a 400 by design (no yes/no->boolean transformer precedent exists
 * anywhere in this repo, and the brief explicitly requires a strict boolean DTO plus
 * a reported Angular follow-up rather than a silently-introduced transformer).
 */
export class FcUnspentDeclarationDataDto {
  @IsOptional()
  @IsBoolean()
  isFcUnspent?: boolean | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => XviFcFileRefDto)
  fcDeclaration?: XviFcFileRefDto | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FcUnspentUlbRowInputDto)
  unspentUlbData?: FcUnspentUlbRowInputDto[];

  @IsOptional()
  @IsBoolean()
  checkboxConfirmation?: boolean;
}

export class SaveFcUnspentDeclarationDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => FcUnspentDeclarationDataDto)
  data!: FcUnspentDeclarationDataDto;
}
