import { IsMongoId, IsObject } from 'class-validator';

export class SaveSfcStatusDto {
  @IsMongoId()
  stateId!: string;

  @IsMongoId()
  yearId!: string;

  @IsObject()
  data!: Record<string, unknown>;
}
