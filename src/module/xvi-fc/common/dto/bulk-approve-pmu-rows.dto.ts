import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { SelectAllMatchingPmuRowsDto } from './select-all-matching-pmu-rows.dto';

/**
 * Shared by PMU review bulk-approve-rows controllers. Exactly one of rowIds or
 * selectAllMatching is required; the service enforces this, following existing conventions.
 * rowIds and excludeRowIds allow up to 1000 entries to support states with up to
 * 800 ULBs, exceeding the shared 500-item limit. selectAllMatching is resolved
 * server-side and requires no array limit.
 */
export class BulkApprovePmuRowsDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsMongoId({ each: true })
  rowIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SelectAllMatchingPmuRowsDto)
  selectAllMatching?: SelectAllMatchingPmuRowsDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsMongoId({ each: true })
  excludeRowIds?: string[];
}
