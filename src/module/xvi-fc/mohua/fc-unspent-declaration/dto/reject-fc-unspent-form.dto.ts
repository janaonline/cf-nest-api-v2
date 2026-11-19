import { IsNotEmpty, IsString } from 'class-validator';

export class RejectFcUnspentFormDto {
  @IsString()
  @IsNotEmpty()
  rejectionRemarks!: string;
}
