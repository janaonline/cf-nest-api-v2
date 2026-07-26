import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsMongoId, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

export class FcUnspentRowRejectionDto {
  @IsMongoId()
  rowId!: string;

  @IsString()
  @IsNotEmpty()
  rejectionRemark!: string;
}

export class BulkRejectFcUnspentRowsDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => FcUnspentRowRejectionDto)
  rows!: FcUnspentRowRejectionDto[];
}
