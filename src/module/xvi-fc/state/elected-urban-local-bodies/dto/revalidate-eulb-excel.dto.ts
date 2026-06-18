import { IsNumber } from 'class-validator';

export class RevalidateEulbExcelDto {
  @IsNumber()
  ulbCount!: number;
}
