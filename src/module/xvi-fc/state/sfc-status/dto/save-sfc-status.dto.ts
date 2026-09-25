import { IsMongoId, IsNotEmpty, IsObject } from 'class-validator';

export class SaveSfcStatusDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsObject()
  data!: Record<string, unknown>;
}
