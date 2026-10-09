import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SelectAllMatchingPmuRowsDto } from './select-all-matching-pmu-rows.dto';

export class PmuRowRejectionDto {
  @IsMongoId()
  rowId!: string;

  @IsString()
  @IsNotEmpty()
  rejectionRemark!: string;
}

/**
 * Shared by PMU review bulk-reject-rows controllers. Exactly one of rows (each with its own
 * remark) or selectAllMatching (all matching rows rejected with a shared rejectionRemark)
 * is required; the service enforces this. Arrays allow up to 1000 entries to support states
 * with up to 800 ULBs (see BulkApprovePmuRowsDto).
 */
export class BulkRejectPmuRowsDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PmuRowRejectionDto)
  rows?: PmuRowRejectionDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SelectAllMatchingPmuRowsDto)
  selectAllMatching?: SelectAllMatchingPmuRowsDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsMongoId({ each: true })
  excludeRowIds?: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  rejectionRemark?: string;
}
