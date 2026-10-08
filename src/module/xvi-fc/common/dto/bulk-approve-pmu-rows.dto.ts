import { ArrayNotEmpty, ArrayUnique, IsArray, IsMongoId, IsNotEmpty } from 'class-validator';

/** Shared by the row-bearing PMU review controllers' bulk-approve-rows endpoint. */
export class BulkApprovePmuRowsDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsMongoId({ each: true })
  rowIds!: string[];
}
