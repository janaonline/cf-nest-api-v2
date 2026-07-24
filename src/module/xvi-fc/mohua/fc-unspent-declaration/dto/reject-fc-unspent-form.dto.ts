import { IsNotEmpty, IsString } from 'class-validator';

export class RejectFcUnspentFormDto {
  @IsString()
  @IsNotEmpty()
  mohuaRemarks!: string;
}
