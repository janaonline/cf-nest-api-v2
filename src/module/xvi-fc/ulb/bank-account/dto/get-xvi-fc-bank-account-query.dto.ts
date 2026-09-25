import { IsMongoId, IsNotEmpty, IsOptional } from 'class-validator';

export class GetXviFcBankAccountQueryDto {
  @IsOptional()
  @IsMongoId()
  ulbId?: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;
}
