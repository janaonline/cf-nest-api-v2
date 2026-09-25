import { IsIn, IsMongoId, IsNotEmpty, IsObject } from 'class-validator';
import { GTC_INSTALLMENTS, type GtcInstallment } from '../constants/gtc.constants';

export class SaveGtcDto {
  @IsMongoId()
  @IsNotEmpty()
  stateId!: string;

  @IsMongoId()
  @IsNotEmpty()
  yearId!: string;

  @IsIn(GTC_INSTALLMENTS)
  installment!: GtcInstallment;

  @IsObject()
  data!: Record<string, unknown>;
}
