import { ArrayNotEmpty, ArrayUnique, IsArray, IsMongoId, IsNotEmpty } from 'class-validator';

export class BulkApproveFcUnspentRowsDto {
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
