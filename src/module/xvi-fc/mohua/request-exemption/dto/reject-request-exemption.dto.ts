import { IsNotEmpty, IsString } from 'class-validator';

export class RejectRequestExemptionDto {
  @IsString()
  @IsNotEmpty()
  mohuaRemarks!: string;
}
