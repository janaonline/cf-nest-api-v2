import { IsMongoId, IsNumberString, IsOptional } from 'class-validator';

export class DumpSfcStatusQueryDto {
  @IsOptional()
  @IsMongoId()
  stateId?: string;

  @IsOptional()
  @IsMongoId()
  yearId?: string;

  @IsOptional()
  @IsNumberString()
  status?: string;
}
