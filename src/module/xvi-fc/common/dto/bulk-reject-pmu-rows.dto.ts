import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsMongoId, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

export class PmuRowRejectionDto {
  @IsMongoId()
  rowId!: string;

  @IsString()
  @IsNotEmpty()
  rejectionRemark!: string;
}

/** Shared by the row-bearing PMU review controllers' bulk-reject-rows endpoint. */
export class BulkRejectPmuRowsDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PmuRowRejectionDto)
  rows!: PmuRowRejectionDto[];
}
