import { IsMongoId, IsNumber, IsPositive } from 'class-validator';

/** Yes-branch row input — whitelisted to exactly {ulbId, unspentAmount}, matching the frontend contract. */
export class FcUnspentUlbRowInputDto {
  @IsMongoId()
  ulbId!: string;

  @IsNumber()
  @IsPositive()
  unspentAmount!: number;
}
